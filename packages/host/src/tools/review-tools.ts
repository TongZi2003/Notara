import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EntityRefSchema, VersionTokenSchema } from '@studyforge/contracts';
import { ReviewMarkSchema } from '@studyforge/contracts/reviews';
import { CardViewSchema } from '@studyforge/contracts/cards';
import { EvidenceQuery } from '@studyforge/domain/evidence';
import { cardBaseline } from '@studyforge/domain/review';
import { observeEvidence } from '../evidence-query.ts';
import { sourceEvidenceObjects } from '../runtime/context-envelope.ts';
import { toolSchema } from './tool-schema.ts';
import { reviewBackfillProblem } from '../handoff-service.ts';
import { teacherContext, observedVersion } from './learning-context.ts';
import { existingProposal, proposeFromTool, proposalOutput } from './proposal-tools.ts';

const InputSchema = z.object({ target: EntityRefSchema, mark: ReviewMarkSchema, note: z.string().min(1), evidence: z.string().regex(/^E[1-9][0-9]*$/) }).strict();

async function freeze(host: Context, execution: ToolRunContext, input: z.infer<typeof InputSchema>) {
  const ctx = await teacherContext(host, execution);
  const catalogue = new EvidenceQuery().catalogue(await observeEvidence(host, ctx.sessionId!, { resolveObjects: query => sourceEvidenceObjects(host, ctx, query.fragments ?? []) }));
  const entry = catalogue.entries.find(row => row.alias === input.evidence);
  if (!entry) throw new Error('请先查询真实依据，选择当前目录中的E别名。');
  const backfill = reviewBackfillProblem(host, ctx, input.target, entry.occurredAt);
  if (backfill) throw new Error(backfill);
  const version = await observedVersion(host, execution, input.target);
  const saved = host.studyforgeCardRecords.read(ctx, input.target, version);
  const observation = await host.sessionQuery.observeSession(SessionId(ctx.sessionId!));
  let sequence: number;
  try {
    const event = observation.events.find(event => event.type === 'user/message' && event.data.id === entry.messageId);
    if (!event || event.type !== 'user/message' || event.data.source.kind !== 'user') throw new Error('review_evidence_not_student');
    sequence = event.seq;
  } finally { observation[Symbol.dispose](); }
  const id = createHash('sha256').update(`${ctx.sessionId}:${entry.messageId}:${input.target}`).digest('hex');
  const occurrence = host.studyforgeReviewService.freeze(ctx, input.target, { id, occurredAt: entry.occurredAt,
    timeZone: host.studyforgeClock.timeZone, order: { sessionId: ctx.sessionId!, sequence } });
  occurrence.cardVersion = cardBaseline(saved.data);
  return { ctx, version, saved, record: { occurrence, mark: input.mark, note: input.note,
    basis: [{ sessionId: ctx.sessionId!, messageId: entry.messageId, occurredAt: entry.occurredAt, source: 'classroom_evidence' as const,
      quote: entry.quote, object: { ref: input.target, version } }] } };
}

export function registerReviewTools(host: Context): void {
  const catalogueSchema = z.object({ entries: z.array(z.object({ alias: z.string(), quote: z.string(), objects: z.array(z.object({ ref: EntityRefSchema, version: VersionTokenSchema }).strict()) }).strict()) }).strict();
  host.effect(() => host.tools.register({ name: 'query_evidence', description: '按需查看原生课堂已接受的学生原话/作答E别名。系统回执和模型回答不属于学生依据。此查询不保存新事实。', parameters: toolSchema(z.object({}).strict()),
    output: { schema: toolSchema(catalogueSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(catalogueSchema.parse(value)) }] },
    async execute(_args, execution) {
      const ctx = await teacherContext(host, execution);
      const catalogue = new EvidenceQuery().catalogue(await observeEvidence(host, ctx.sessionId!, { resolveObjects: query => sourceEvidenceObjects(host, ctx, query.fragments ?? []) }));
      return { entries: catalogue.entries.map(({ alias, quote, objects }) => ({ alias, quote, objects })) };
    },
  }));
  host.effect(() => host.tools.register({ name: 'propose_review', description: '通常课内复习先向学生确认判定。给刚读过的普通卡、五档结果、证据说明和真实E别名；Host绑定实际作答时刻与版本，确认日不会替代作答日。', parameters: toolSchema(InputSchema), output: proposalOutput(),
    async execute(args, execution) {
      const input = InputSchema.parse(args), prior = await existingProposal(host, execution);
      if (prior) return prior;
      const frozen = await freeze(host, execution, input);
      return proposeFromTool(host, execution, { title: frozen.saved.data.content.title, items: [{ target: input.target, baseline: frozen.version,
        effect: { kind: 'review', record: { ...frozen.record, channel: '课内' } } }] });
    },
  }));
  host.effect(() => host.tools.register({ name: 'record_review', description: '窄直接记档：课上首次实际学过未学卡，或非复习目的课堂顺带真正使用过既有卡。通常复习用propose_review。需刚读过的卡和真实E依据；通道、时间、对象版本由Host绑定。', parameters: toolSchema(InputSchema),
    output: { schema: toolSchema(CardViewSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(CardViewSchema.parse(value)) }] },
    async execute(args, execution) {
      const input = InputSchema.parse(args), frozen = await freeze(host, execution, input);
      const current = host.studyforgeCardRecords.read(frozen.ctx, input.target);
      const prior = current.data.history.find(entry => entry.occurrence.id === frozen.record.occurrence.id);
      const record = { ...frozen.record, occurrence: prior?.occurrence ?? frozen.record.occurrence, basis: prior?.basis ?? frozen.record.basis,
        channel: prior?.channel ?? (frozen.saved.data.review ? '顺带' as const : '课内' as const) };
      return (await host.studyforgeReviewService.record(frozen.ctx, input.target, record)).card;
    },
  }));
}
