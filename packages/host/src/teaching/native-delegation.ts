/**
 * P7.4 native helpers (plan §P7.4): search, problem writing, tutoring and peer
 * review, all running as real native subagents instead of a second delegation
 * manager.
 *
 * What this module owns, and nothing more:
 *  - the role contract: which tools a role's child may keep, the persona it
 *    runs under, and the exact task text it receives;
 *  - the narrow conversion between one role's authored input/result and the
 *    published `ctx.subagents.start` / `startContinuable` seams;
 *  - the one place a structured problem set becomes real cards: the Host
 *    validates every draft and publishes them through the workspace's single
 *    atomic boundary, so the main model never transcribes a card by hand.
 *
 * What it deliberately does NOT own: child lifecycle, message delivery,
 * interruption, listing, usage and the subagent surface in the student UI.
 * Those stay with `ctx.subagents`, the native `send_message` /
 * `interrupt_agent` tools and the native ui-subagent.
 *
 * Isolation is enforced by the runtime, not by wording: `spawn` children start
 * with no parent conversation, and the child's own creation window applies
 * `tools.restrict({ allow })` against the surface its parent really has, so a
 * name that is not on the role's list disappears from the child's prompt AND
 * refuses to execute. The list is intersected with the calling scope's real
 * visible tools first — an absolute allow-list that named tools a deployment
 * does not mount would be rejected by the registry, so an absent tool is
 * reported in the result's `surface` instead of silently widening the child.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-subagent';
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent';
import { assertObjectJsonSchema, type ObjectJsonSchema, type ToolRestriction, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import type { MutationContext, SourceAnchor } from '@studyforge/contracts';
import { SourceAnchorSchema } from '@studyforge/contracts/materials';
import { ClassmateRouteSchema, type ClassmateRoute } from '@studyforge/contracts/classroom';
import type { CardContent } from '@studyforge/contracts/cards';
import { toolSchema } from '../tools/tool-schema.ts';
import { teacherContext } from '../tools/learning-context.ts';
import { entityReferenceContent } from '../tools/entity-reference-output.ts';
import { teachingText } from './teaching-overrides.ts';

/** The four built-in helper roles a lesson can delegate one task to. */
export const DelegationRoleSchema = z.enum(['search', 'problem', 'assistant', 'peer']);
export type DelegationRole = z.infer<typeof DelegationRoleSchema>;
export const DELEGATION_ROLES: readonly DelegationRole[] = DelegationRoleSchema.options;

/** The model-facing tool each role is reached through. */
export const DELEGATION_TOOLS: Record<DelegationRole, string> = {
  search: 'delegate_search',
  problem: 'delegate_problem',
  assistant: 'delegate_assistant',
  peer: 'delegate_peer',
};

/** One refused delegation, with the rule that refused it. */
export class DelegationError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = 'DelegationError';
    this.code = code;
  }
}

interface RoleSpec {
  /** Short display label persisted with the child session. */
  readonly title: string;
  /** Model-facing description of the tool that reaches this role. */
  readonly description: string;
  /**
   * Global tool names this child may keep. `send_message` is added for a
   * background run, because a continuable child reports back through it.
   */
  readonly allow: readonly string[];
}

/**
 * The role contract. Every role is material-first: none of them keeps a
 * student-state reader (`query_evidence`, `read_memory`, `read_card`'s history,
 * `record_review`, `propose_review`), a writer (`update_card`, `register_cards`,
 * `note_method`, `propose_*`), an arbitrary filesystem tool (`read`, `write`,
 * `edit`, `glob`, `grep`, `read_image`) or the delegation tools themselves.
 */
export const ROLES: Record<DelegationRole, RoleSpec> = {
  search: {
    title: '检索帮手',
    description: '把一次检索交给独立帮手：它看不到本课对话与学生学情，只拿到这一条检索任务，可读本人资料与外部来源。返回它的原话与线索；结果只是线索，是否采信由你判断，它不写任何学习事实。',
    allow: ['web_search', 'web_fetch', 'list_materials', 'read_material', 'preview_region', 'search_learning', 'read_content', 'list_sets', 'read_set', 'read_skeleton', 'read_method'],
  },
  problem: {
    title: '命题帮手',
    description: '把出题交给独立帮手：只给目标、约束与真实来源锚点，它看不到本课对话与学情。产物按结构化格式返回，由Host校验后直接登记为未学普通题卡，只回题面与卡引用；不要自己转抄题目正文，解答留在卡背。',
    allow: ['list_materials', 'read_material', 'preview_region', 'search_learning', 'read_skeleton', 'read_method'],
  },
  assistant: {
    title: '助教',
    description: '把一次判断交给助教：输入只有材料与已有标准，它看不到本课对话、学情与E依据。没有参考解或评分标准就不要派它评。返回它的原话，逐字呈现给学生时由你负责。',
    allow: ['list_materials', 'read_material', 'preview_region', 'read_skeleton'],
  },
  peer: {
    title: '同伴',
    description: '把学生自己写下的解释交给同伴评审：只给材料与学生原话，不给参考答案。返回它的原话；它只评审学生的推理，不提供题解。',
    allow: ['list_materials', 'read_material'],
  },
};

/** One material excerpt the parent quotes into an isolated helper's context. */
export const MaterialExcerptSchema = z.object({
  title: z.string().trim().min(1).describe('材料标题或书名'),
  text: z.string().min(1).describe('材料原文片段，逐字引用'),
}).strict();
export type MaterialExcerpt = z.infer<typeof MaterialExcerptSchema>;

/** One delegation's model route: the child runs under it instead of the teacher's. */
const DelegationRouteSchema = ClassmateRouteSchema.describe('本次任务使用的模型路由：provider与model必须是已配置的provider路由；省略跟随本课老师。只影响本次委派。');

/** Search: one retrieval task, optionally kept as a durable child for follow-ups. */
export const SearchDelegationInputSchema = z.object({
  task: z.string().trim().min(1).describe('要查什么；只写这一次检索需要的缺口'),
  context: z.string().trim().min(1).optional().describe('必要的约束或已知线索；不要粘贴本课对话'),
  background: z.boolean().default(false).describe('true 时建立可持续追问的子会话，稍后用原生 send_message 继续'),
  route: DelegationRouteSchema.optional(),
}).strict();

/** Tutor: materials plus an existing standard, never the lesson or the student's own history. */
export const AssistantDelegationInputSchema = z.object({
  materials: z.array(MaterialExcerptSchema).min(1).describe('只能依据的材料原文'),
  standard: z.string().trim().min(1).describe('已有标准或参考解；没有标准就不要派助教'),
  question: z.string().trim().min(1).optional().describe('要判断什么'),
  route: DelegationRouteSchema.optional(),
}).strict();

/** Peer: the student's own words plus materials. There is no field for an answer. */
export const PeerDelegationInputSchema = z.object({
  materials: z.array(MaterialExcerptSchema).min(1).describe('只能依据的材料原文'),
  explanation: z.string().trim().min(1).describe('学生自己写下的解释原话'),
  question: z.string().trim().min(1).optional().describe('要评审什么'),
  route: DelegationRouteSchema.optional(),
}).strict();

/** Problem writing: only a goal, its constraints and the real anchors to honour. */
export const ProblemDelegationInputSchema = z.object({
  target: z.string().trim().min(1).describe('要练什么'),
  constraints: z.string().trim().min(1).optional().describe('题目约束，例如难度、题量以外的要求'),
  count: z.number().int().min(1).max(5).default(1),
  sources: z.array(SourceAnchorSchema).max(8).default([]).describe('这些题真实依据的材料位置；登记时原样挂在卡上'),
  route: DelegationRouteSchema.optional(),
}).strict();

/** One proposed problem. The solution is stored behind the face and never returned early. */
export const ProblemDraftSchema = z.object({
  title: z.string().trim().min(1),
  front: z.string().trim().min(1).describe('题面，可独立作答'),
  solution: z.string().trim().min(1).describe('参考解，登记后存放在卡背'),
  notes: z.string().default(''),
  tags: z.array(z.string().trim().min(1)).default([]),
}).strict();
export const ProblemSetSchema = z.object({ problems: z.array(ProblemDraftSchema).min(1) }).strict();

/** One published, unlearned problem card: the face plus its real identity. */
export const ProblemCardViewSchema = z.object({
  ref: z.string().min(1), version: z.number().int().positive(), title: z.string().min(1), front: z.string().min(1),
}).strict();

/** One completed delegation, carrying the child's own words verbatim. */
export const DelegationResultSchema = z.object({
  role: DelegationRoleSchema,
  childId: z.string().min(1),
  output: z.string(),
  stopReason: z.string().min(1),
  background: z.boolean(),
  surface: z.array(z.string().min(1)),
  route: ClassmateRouteSchema.optional(),
}).strict();

/** One problem delegation: the registered cards, never their solutions. */
export const ProblemResultSchema = z.object({
  role: z.literal('problem'),
  childId: z.string().min(1),
  stopReason: z.string().min(1),
  surface: z.array(z.string().min(1)),
  route: ClassmateRouteSchema.optional(),
  cards: z.array(ProblemCardViewSchema).min(1),
}).strict();

/** The role briefs: the persona each role's child really runs under. */
export interface AssistantBriefs {
  readonly dir: string;
  readonly persona: Record<DelegationRole, string>;
}

/**
 * Load the four role briefs from their real directory. The files are prose the
 * child receives as its persona; the tool surface stays in this module, so a
 * brief can never widen what a role may do. A missing or empty brief, or one
 * that would be read as a persona template, fails loud at registration.
 */
export function loadAssistantBriefs(dir: string): AssistantBriefs {
  const read = (role: DelegationRole): string => {
    let text: string;
    try { text = readFileSync(join(dir, `${role}.md`), 'utf8').trim(); }
    catch (error) { throw new DelegationError('assistant_brief_missing', `${role}.md (${dir}): ${String(error)}`); }
    if (text.length === 0) throw new DelegationError('assistant_brief_empty', `${role}.md`);
    if (text.includes('{{')) throw new DelegationError('assistant_brief_template', `${role}.md`);
    return text;
  };
  return { dir, persona: { search: read('search'), problem: read('problem'), assistant: read('assistant'), peer: read('peer') } };
}

/** The task text one role's child receives. Nothing from the lesson is added. */
export function searchTask(input: z.output<typeof SearchDelegationInputSchema>): string {
  return [
    '检索任务：' + input.task,
    ...(input.context === undefined ? [] : ['已知与约束：' + input.context]),
    '只依据你实际读到的内容回答：给出你找到的出处（外部 URL，或本人资料的固定版本与位置）、能否支撑这个任务，以及仍不确定的部分。',
    '先枚举书目与实际目录，list_materials有nextOffset就继续翻页。已有卡片/知识同属候选，用search_learning找，再read_content精读，必要时沿links继续。每个候选返回固定身份与版本、实际位置、短摘录、支持的教学环节、先修条件。没有找到、尚未读、截断和读取失败分开说明；不把摘要当作完整原文，也不把读卡当作学生学过。独立的检索范围由主教师分派，本次只完成给你的范围。',
    ...(input.background ? ['这是一次可继续追问的检索；需要时用 send_message 把阶段性结论发回父会话。'] : []),
  ].join('\n');
}

export function assistantTask(input: z.output<typeof AssistantDelegationInputSchema>): string {
  return [
    ...(input.question === undefined ? [] : ['要判断的问题：' + input.question]),
    '材料（只依据下列材料，不要假设材料之外的内容）：',
    ...input.materials.flatMap(material => ['## ' + material.title, material.text]),
    '已有标准：',
    input.standard,
    '请按已有标准核对上面的材料，说清哪一步成立、哪一步不成立，以及标准没有覆盖的地方。',
  ].join('\n');
}

export function peerTask(input: z.output<typeof PeerDelegationInputSchema>): string {
  return [
    ...(input.question === undefined ? [] : ['要评审的问题：' + input.question]),
    '学生自己写下的解释：',
    input.explanation,
    '相关材料（只依据下列材料）：',
    ...input.materials.flatMap(material => ['## ' + material.title, material.text]),
    '没有参考答案：只顺着他的推理看他能不能走到结论，指出跳过的步骤，不给题解。',
  ].join('\n');
}

export function problemTask(input: z.output<typeof ProblemDelegationInputSchema>): string {
  const anchors = input.sources.map(source => `${source.materialId}@${source.versionId} ${JSON.stringify(source.locator)}${source.quote === undefined ? '' : ' 原文：' + source.quote}`);
  return [
    `出题目标：${input.target}`,
    ...(input.constraints === undefined ? [] : ['题目约束：' + input.constraints]),
    `题量：${input.count}`,
    ...(anchors.length === 0 ? [] : ['真实来源位置（题干与解答都要对得上这些位置，不虚构页码与原文）：', ...anchors]),
    '按结构化格式返回：front 是可独立作答的题面，solution 是参考解，题面里不要出现解答。',
  ].join('\n');
}

/** One accepted child run, in the vocabulary the calling tool answers with. */
export interface DelegationOutcome {
  readonly role: DelegationRole;
  readonly childId: string;
  readonly output: string;
  readonly stopReason: string;
  readonly background: boolean;
  readonly surface: readonly string[];
  readonly route?: ClassmateRoute;
}

/** One problem delegation's real effect: registered cards, faces only. */
export interface ProblemOutcome {
  readonly role: 'problem';
  readonly childId: string;
  readonly stopReason: string;
  readonly surface: readonly string[];
  readonly route?: ClassmateRoute;
  readonly cards: readonly z.output<typeof ProblemCardViewSchema>[];
}

type DelegationParent = SubagentStartRequest['parent'];

/** The per-child AgentOptions one delegation route resolves to, if any. */
function routeOptions(route: ClassmateRoute | undefined): AgentOptions | undefined {
  if (!route) return undefined;
  const options: AgentOptions = { provider: route.provider, model: route.model };
  if (route.reasoningEffort !== undefined) options.reasoningEffort = route.reasoningEffort as NonNullable<AgentOptions['reasoningEffort']>;
  if (route.maxTokens !== undefined) options.maxTokens = route.maxTokens;
  return options;
}

/**
 * The role adapter. One instance per Host; it holds no child handle, no queue
 * and no state of its own — every call is one native start and one collection.
 */
export class TeachingDelegation {
  private readonly host: Context;
  private readonly briefs: AssistantBriefs;
  private readonly provider: string;
  constructor(host: Context, briefs: AssistantBriefs, provider = 'spawn') {
    this.host = host;
    this.briefs = briefs;
    this.provider = provider;
  }

  /**
   * The real tool surface a role's child keeps: the role's own list, limited to
   * names the calling agent can actually see. A background run additionally
   * needs `send_message`, which is what carries its answer back to the parent.
   */
  surface(role: DelegationRole, parent: DelegationParent, options: { readonly background?: boolean } = {}): readonly string[] {
    // The registry's scope key is the Agent, not its registration Context.
    // Native control tools are agent-local and absent from a context-object view.
    const visible = new Set(this.host.tools.schemas(parent).map(schema => schema.name));
    const wanted = options.background === true ? [...ROLES[role].allow, 'send_message'] : ROLES[role].allow;
    return wanted.filter(name => visible.has(name));
  }

  /**
   * Run one role once. A foreground run resolves after its child's turn is
   * collected and released; a background run resolves as soon as the child's
   * inbox accepted the task, and its own `send_message` carries the answer back.
   */
  async run(input: {
    readonly role: DelegationRole; readonly parent: DelegationParent; readonly task: string;
    readonly signal: AbortSignal; readonly background?: boolean; readonly route?: ClassmateRoute;
  }): Promise<DelegationOutcome> {
    const { role, parent, task, signal } = input;
    const background = input.background === true;
    if (background && role !== 'search') throw new DelegationError('delegation_background_unsupported', role);
    const surface = this.surface(role, parent, { background });
    if (background && !surface.includes('send_message')) {
      throw new DelegationError('delegation_background_unavailable', '本课没有可回话的原生子会话通道，请改用前台检索');
    }
    const filter: ToolRestriction = { allow: [...surface] };
    const prompt: SubagentStartRequest['prompt'] = [{ type: 'text', text: task }];
    const persona = teachingText(this.host, 'assistant/' + role, this.briefs.persona[role]);
    const agentOptions = routeOptions(input.route);
    if (background) {
      const started = await this.host.subagents.startContinuable({
        provider: this.provider, label: ROLES[role].title,
        request: { prompt, parent, persona, toolFilter: filter, ...(agentOptions ? { agentOptions } : {}) }, signal,
      });
      return { role, childId: String(started.childId), output: '', stopReason: 'accepted', background: true, surface, ...(input.route ? { route: input.route } : {}) };
    }
    const run = await this.host.subagents.start(this.provider, {
      label: ROLES[role].title, prompt, parent, signal, persona, toolFilter: filter,
      ...(agentOptions ? { agentOptions } : {}),
    });
    const childId = String(run.id);
    const result = await settle(run);
    if (result.stopReason !== 'completed') throw incomplete(result, childId);
    return { role, childId, output: textOf(result), stopReason: result.stopReason, background: false, surface, ...(input.route ? { route: input.route } : {}) };
  }

  /**
   * Write problems in an isolated child, then register what it produced.
   *
   * The child only ever answers with structured drafts; every draft is checked
   * (real sources, real chapter, its own rewritten text) and then all of them
   * are published through one atomic boundary, so a partial set never becomes
   * visible. The caller gets the faces and their identities — the solutions
   * stay behind the card's own face, and no model transcribes them by hand.
   */
  async proposeProblems(input: {
    readonly parent: DelegationParent; readonly signal: AbortSignal; readonly context: MutationContext;
    readonly target: string; readonly constraints?: string; readonly count?: number; readonly sources?: readonly SourceAnchor[];
    readonly route?: ClassmateRoute;
  }): Promise<ProblemOutcome> {
    const parsed = ProblemDelegationInputSchema.parse({
      target: input.target, count: input.count ?? 1, sources: input.sources ?? [],
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      ...(input.route === undefined ? {} : { route: input.route }),
    });
    const surface = this.surface('problem', input.parent);
    const filter: ToolRestriction = { allow: [...surface] };
    const agentOptions = routeOptions(parsed.route);
    const run = await this.host.subagents.start(this.provider, {
      label: ROLES.problem.title,
      prompt: [{ type: 'text', text: problemTask(parsed) }],
      parent: input.parent, signal: input.signal, persona: teachingText(this.host, 'assistant/problem', this.briefs.persona.problem),
      toolFilter: filter, outputSchema: PROBLEM_OUTPUT_SCHEMA,
      ...(agentOptions ? { agentOptions } : {}),
    });
    const childId = String(run.id);
    const result = await settle(run);
    if (result.stopReason !== 'completed') throw incomplete(result, childId);
    const drafts = ProblemSetSchema.safeParse(result.structured);
    if (!drafts.success) {
      throw new DelegationError('delegation_output_invalid', drafts.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('; '));
    }
    if (drafts.data.problems.length > parsed.count) {
      throw new DelegationError('delegation_output_invalid', `要求 ${parsed.count} 道，返回 ${drafts.data.problems.length} 道`);
    }
    const context = input.context;
    // Every draft is checked before the first row lands: sources resolve, the
    // math in the text this write authored is balanced, and the card is legal.
    const contents: CardContent[] = [];
    for (const draft of drafts.data.problems) {
      contents.push(await this.host.studyforgeCardService.check(context, {
        title: draft.title, presentation: 'problem', front: draft.front,
        sections: [{ heading: '解答', body: draft.solution }],
        notes: draft.notes, sources: [...parsed.sources], tags: draft.tags, links: [],
      }));
    }
    const plans = contents.map((content, index) => {
      const operationId = `${context.operationId}:${index}`;
      const id = 'card_' + createHash('sha256').update(`${context.workspaceId}:${operationId}`).digest('hex').slice(0, 24);
      return this.host.studyforgeCardRecords.prepareCreate({ ...context, operationId }, id, { content, history: [] });
    });
    await this.host.studyforgeRecords.atomic(plans);
    return {
      role: 'problem', childId, stopReason: result.stopReason, surface,
      ...(parsed.route ? { route: parsed.route } : {}),
      cards: plans.map(plan => ProblemCardViewSchema.parse({
        ref: plan.result.ref, version: plan.result.version,
        title: plan.result.data.content.title, front: plan.result.data.content.front,
      })),
    };
  }
}

/** The object-rooted schema one problem child answers through. */
function problemOutputSchema(): ObjectJsonSchema {
  const schema: unknown = {
    type: 'object', additionalProperties: false, required: ['problems'],
    properties: {
      problems: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['title', 'front', 'solution'],
          properties: {
            title: { type: 'string', description: '卡片标题' },
            front: { type: 'string', description: '题面，可独立作答' },
            solution: { type: 'string', description: '参考解，登记后存放在卡背' },
            notes: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
  assertObjectJsonSchema(schema);
  return schema;
}
const PROBLEM_OUTPUT_SCHEMA = problemOutputSchema();

/** Collect one foreground run and release it without letting disposal mask a failure. */
async function settle(run: SubagentRun): Promise<SubagentResult> {
  const [execution] = await Promise.allSettled([run.result]);
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') throw new AggregateError([execution.reason, disposal.reason], `delegation run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`);
    throw execution.reason;
  }
  if (disposal.status === 'rejected') throw disposal.reason;
  return execution.value;
}

/** A run that ended without finishing is reported, never silently accepted. */
function incomplete(result: SubagentResult, childId: string): DelegationError {
  const partial = textOf(result);
  const diagnostic = result.diagnostic === undefined ? '' : ` / ${result.diagnostic}`;
  return new DelegationError('delegation_incomplete', `${childId} ${result.stopReason}${diagnostic}${partial.length === 0 ? '' : ` / 已产出：${partial}`}`);
}

function textOf(result: SubagentResult): string {
  return result.output.filter(block => block.type === 'text').map(block => block.text).join('');
}

/** Options for {@link registerDelegationTools}. */
export interface DelegationToolOptions {
  /** Directory holding `<role>.md`; the same four briefs the child runs under. */
  readonly assistantsDir: string;
  /** `ctx.subagents` provider name; the StudyForge preset mounts `spawn`. */
  readonly provider?: string;
}

/**
 * Register the four role tools on one Host. Main wiring owns where the briefs
 * live and which provider is mounted; this function only turns an accepted
 * tool call into one real native delegation.
 */
export function registerDelegationTools(host: Context, options: DelegationToolOptions): TeachingDelegation {
  const delegation = new TeachingDelegation(host, loadAssistantBriefs(options.assistantsDir), options.provider ?? 'spawn');
  const register = <I extends z.ZodType>(
    name: string, description: string, input: I, output: z.ZodType,
    run: (args: z.output<I>, execution: ToolRunContext) => Promise<unknown>,
  ): void => {
    host.effect(() => host.tools.register({
      name, description: description + ' 专门的检索/命题/助教/同伴任务选delegate的对应method，它们也复用原生子会话；通用独立任务才用subagent。后台任务沿返回的真实childId用send_message/interrupt_agent管理，不重复另开。可选route给本次委派指定另一模型路由（provider+model，可带reasoningEffort/maxTokens），省略跟随本课老师。', parameters: toolSchema(input),
      output: { schema: toolSchema(output), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(output.parse(value)) }, ...entityReferenceContent(value)] },
      async execute(args: unknown, execution: ToolRunContext) { return run(input.parse(args), execution); },
    }));
  };
  const parentOf = (execution: ToolRunContext): DelegationParent => {
    if (!execution.agent) throw new DelegationError('delegation_session_required');
    return execution.agent;
  };

  register(DELEGATION_TOOLS.search, ROLES.search.description, SearchDelegationInputSchema, DelegationResultSchema,
    (input, execution) => delegation.run({ role: 'search', parent: parentOf(execution), task: searchTask(input), signal: execution.signal, background: input.background, ...(input.route ? { route: input.route } : {}) }));
  register(DELEGATION_TOOLS.assistant, ROLES.assistant.description, AssistantDelegationInputSchema, DelegationResultSchema,
    (input, execution) => delegation.run({ role: 'assistant', parent: parentOf(execution), task: assistantTask(input), signal: execution.signal, ...(input.route ? { route: input.route } : {}) }));
  register(DELEGATION_TOOLS.peer, ROLES.peer.description, PeerDelegationInputSchema, DelegationResultSchema,
    (input, execution) => delegation.run({ role: 'peer', parent: parentOf(execution), task: peerTask(input), signal: execution.signal, ...(input.route ? { route: input.route } : {}) }));
  register(DELEGATION_TOOLS.problem, ROLES.problem.description, ProblemDelegationInputSchema, ProblemResultSchema,
    async (input, execution) => {
      const context = await teacherContext(host, execution);
      return delegation.proposeProblems({
        parent: parentOf(execution), signal: execution.signal, context,
        target: input.target, count: input.count, sources: input.sources,
        ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
        ...(input.route === undefined ? {} : { route: input.route }),
      });
    });
  return delegation;
}
