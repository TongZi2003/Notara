/**
 * P7.5 model-facing tools for the confirmed close (plan §P7.5, CONTRACTS.md §7).
 *
 * Two things only: propose the teacher's free summary for the student to accept,
 * and read the exact saved summary this lesson received. Neither tool writes a
 * record — accepting the proposal is what closes the lesson, and the Host then
 * injects the real cutoff, the real facts and the fixed continuation pin.
 *
 * `read_handoff` deliberately reads through the lesson's own pin: a later
 * correction of a summary never silently becomes the version a continuing
 * lesson is teaching from.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { EntityRefSchema } from '@studyforge/contracts';
import { HandoffViewSchema } from '@studyforge/contracts/handoffs';
import { toolSchema } from './tool-schema.ts';
import { teacherContext, rejected } from './learning-context.ts';
import { existingProposal, proposeFromTool, proposalOutput } from './proposal-tools.ts';
import { checkHandoffProposal, handoffSnapshot } from '../handoff-service.ts';

/** The model-facing shape of `propose_handoff`; exported so its JSON-Schema
 * narrowing is asserted by the Host test, not only at runtime. */
export const ProposeHandoffInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('close'), title: z.string().trim().min(1), body: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('revise'), target: EntityRefSchema, title: z.string().trim().min(1).optional(), body: z.string().min(1) }).strict(),
]);
/** The model-facing shape of `read_handoff`. */
export const ReadHandoffInput = z.object({ ref: EntityRefSchema.optional(), version: z.number().int().positive().optional() }).strict();

export function registerHandoffTools(host: Context): void {
  host.effect(() => host.tools.register({
    name: 'propose_handoff',
    description: '提出收课小结交学生确认：学生点头后系统把小结与关闭事实在同一次原生提交里写入，课在本课继续可讨论、状态保持结束。kind=close 是本课收尾，标题加自由正文即可，不必列全当时的事；kind=revise 更正已保存的小结，先读同一 handoff target，正文替换旧版并生成新的不可变版本。真实输入截止点与当时的系统事实由Host在提案那一刻按原生日志绑定并冻结，不要自己编。',
    parameters: toolSchema(ProposeHandoffInput), output: proposalOutput(),
    async execute(args: unknown, execution: ToolRunContext) {
      const input = ProposeHandoffInput.parse(args), prior = await existingProposal(host, execution);
      if (prior) return prior;
      const ctx = await teacherContext(host, execution);
      if (input.kind === 'close') {
        // A second summary must not close the same lesson twice; refuse here so the
        // teacher never proposes an item that can only fail at confirmation.
        checkHandoffProposal(host, ctx);
        // Freeze the real student-input cutoff, the system facts and the
        // continuation now, so what the student confirms is exactly what saves.
        const snapshot = await handoffSnapshot(host, ctx, execution.callId);
        return proposeFromTool(host, execution, { title: input.title,
          items: [{ target: null, baseline: null, effect: { kind: 'handoff', draft: { title: input.title, body: input.body }, ...snapshot } }] });
      }
      const current = host.studyforgeHandoffService.read(ctx, input.target);
      return proposeFromTool(host, execution, { title: input.title ?? current.title,
        items: [{ target: input.target, baseline: current.version,
          effect: { kind: 'handoff-edit', correction: { ...(input.title === undefined ? {} : { title: input.title }), body: input.body } } }] });
    },
  }));
  host.effect(() => host.tools.register({
    name: 'read_handoff',
    description: '读本课的小结：本课自己收过课时读它最新的一版（更正过就读到更正后的正文），还没收课、只是接续了上一课时读上一课固定给它的那一版；也可以显式给 ref/version 读某一份。更正前先读，读到哪一版就认哪一版。',
    parameters: toolSchema(ReadHandoffInput),
    output: { schema: toolSchema(HandoffViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(HandoffViewSchema.parse(value)) }] },
    async execute(args: unknown, execution: ToolRunContext) {
      const input = ReadHandoffInput.parse(args), ctx = await teacherContext(host, execution), service = host.studyforgeHandoffService;
      if (input.ref !== undefined) return service.read(ctx, input.ref, input.version);
      const course = host.studyforgeCourseMetadata.read(ctx).data;
      // Own summary first: after a correction the teacher must read the newest wording,
      // or "先读再改" would hand back the revision the correction already replaced.
      // A continuation is the fixed pin the lesson was handed, so it stays exact.
      if (course.closure) return service.read(ctx, course.closure.handoffRef);
      if (course.continuation !== undefined) return service.readPinned(ctx, course.continuation);
      throw rejected('本课还没有小结可读');
    },
  }));
}
