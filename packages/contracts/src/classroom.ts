import { z } from 'zod';

export const Key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const ClassroomAvatarRefSchema = z.string().regex(/^avatar:[a-f0-9]{64}$/);
export interface ClassroomAvatarImage { ref: string; mediaType: 'image/webp'; base64: string }
export function classmateMention(name: string, classroom: string): string { return '@' + name + '（' + classroom + '）'; }
/** Exact DSH child route saved with a classroom role. Omit to inherit the teacher route. */
export const ClassmateRouteSchema = z.object({
  provider: z.string().trim().min(1).max(120), model: z.string().trim().min(1).max(240),
  reasoningEffort: z.string().trim().min(1).max(80).optional(),
  maxTokens: z.number().int().positive().max(200000).optional(),
}).strict();
export type ClassmateRoute = z.infer<typeof ClassmateRouteSchema>;
export interface ClassroomModelRoute {
  provider: string; providerName: string; model: string; modelName: string;
  reasoningEfforts: { id: string; name: string }[];
}
/** Situational role-play setting only: who this classmate is to someone in the
 * room. Not learning evidence and never read from or written into student memory. */
export const ClassmateRelationSchema = z.object({
  target: Key.describe('另一位同学的id，或 student（学生）/teacher（老师）。'),
  label: z.string().trim().min(1).max(40).describe('关系称呼，如 同桌、青梅竹马、竞争对手。'),
  intimacy: z.number().int().min(0).max(100).optional().describe('亲密度0-100的情景设定；只是角色背景，不评价学习。'),
  note: z.string().trim().max(600).default('').describe('这段关系的情景细节与相处方式。'),
}).strict();
export type ClassmateRelation = z.infer<typeof ClassmateRelationSchema>;
export const ClassmateSchema = z.object({
  id: Key, name: z.string().trim().min(1).max(32), purpose: z.string().trim().min(1).max(160),
  instructions: z.string().trim().min(1).max(4000), enabled: z.boolean(),
  personality: z.string().trim().max(200).optional().describe('性格标签，如 安静谨慎、爱开玩笑；只是扮演背景。'),
  greeting: z.string().trim().max(600).optional().describe('首次公开发言时的开场白与语气样板；不代替任务内容。'),
  talkativeness: z.number().int().min(0).max(100).optional().describe('发言倾向0-100，只作老师安排参与的参考，不自动发言。'),
  route: ClassmateRouteSchema.optional().describe('这位同学的默认路由；省略表示跟随老师。'),
  avatar: ClassroomAvatarRefSchema.optional().describe('通过本地头像上传得到的引用；改写角色时保留，不自行编造或写图片数据。'),
  relations: z.array(ClassmateRelationSchema).max(12).optional().describe('这位同学对教室里其他人的情景关系；不记学习事实。'),
}).strict();
export type Classmate = z.infer<typeof ClassmateSchema>;
export const ClassroomTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }).strict(),
  z.object({ kind: z.literal('round'), every: z.number().int().min(1).max(50) }).strict(),
  z.object({ kind: z.literal('stage') }).strict(),
]);
export const ClassroomActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('classmate'), roleId: Key, task: z.string().trim().min(1).max(2000),
    materials: z.array(z.enum(['question', 'words', 'conditions', 'summary'])).min(1).max(4),
    destination: z.enum(['conversation', 'teacher']),
  }).strict(),
  z.object({ kind: z.literal('teacher'), instruction: z.string().trim().min(1).max(2000) }).strict(),
]);
export const ClassroomRuleSchema = z.object({
  id: Key, title: z.string().trim().min(1).max(120), enabled: z.boolean(),
  trigger: ClassroomTriggerSchema, action: ClassroomActionSchema,
}).strict();
export type ClassroomRule = z.infer<typeof ClassroomRuleSchema>;
/** User-authored reusable configuration. Runtime identities and task results live elsewhere. */
export const ClassroomDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(100), roles: z.array(ClassmateSchema).max(8),
  rules: z.array(ClassroomRuleSchema).max(24), carrySummary: z.boolean(),
  scenario: z.string().trim().max(2000).optional().describe('教室的情景前提与舞台背景；纯扮演设定。'),
  studentPersona: z.string().trim().max(800).optional().describe('学生在这个情景里扮演的身份；只是设定，不记学习事实。'),
}).strict().superRefine((value, ctx) => {
  for (const key of ['roles', 'rules'] as const) if (new Set(value[key].map(item => item.id)).size !== value[key].length) {
    ctx.addIssue({ code: 'custom', path: [key], message: 'classroom_duplicate_id' });
  }
  if (new Set(value.roles.map(item => item.name)).size !== value.roles.length) ctx.addIssue({ code: 'custom', path: ['roles'], message: 'classroom_duplicate_name' });
  const ids = new Set(value.roles.map(item => item.id));
  value.roles.forEach((role, index) => role.relations?.forEach((relation, rIndex) => {
    if (relation.target === role.id || (relation.target !== 'student' && relation.target !== 'teacher' && !ids.has(relation.target))) {
      ctx.addIssue({ code: 'custom', path: ['roles', index, 'relations', rIndex, 'target'], message: 'classroom_relation_target' });
    }
  }));
  value.rules.forEach((rule, index) => {
    const action = rule.action;
    if (action.kind === 'classmate' && !value.roles.some(role => role.id === action.roleId)) {
      ctx.addIssue({ code: 'custom', path: ['rules', index, 'action', 'roleId'], message: 'classroom_role_missing' });
    }
  });
});
export type ClassroomDefinition = z.infer<typeof ClassroomDefinitionSchema>;

export const ClassmateMaterialSchema = z.object({
  title: z.string().trim().min(1).max(120).describe('这段材料的含义，例如被评议原话、原题、必要条件或已有标准。'),
  text: z.string().trim().min(1).max(16000).describe('老师已读取并选择交付的原文或材料；评议对象保留原话，不能用老师预设结论代替。'),
}).strict();
export const ClassmateTaskInputSchema = z.object({
  id: z.string().min(1).max(200).describe('本课上下文或read_classroom返回的教室工作台id。'),
  roleId: Key.describe('本课已启用角色的id；从课堂配置选择，不自行创建。'),
  task: z.string().trim().min(1).max(4000).describe('这位同学需要独立完成的具体任务。'),
  materials: z.array(ClassmateMaterialSchema).min(1).max(12).describe('完成本次任务所需的材料。子智能体无法自行检索，也不会收到父会话。'),
  destination: z.enum(['conversation', 'teacher']).describe('conversation公开署名回应，只交可公开材料；teacher用于含解答或标准的内部备课。'),
  routeOverride: ClassmateRouteSchema.optional().describe('老师本次任务指定的模型路由；只影响本次任务，不改写同学默认路由。'),
}).strict().refine(value => JSON.stringify(value.materials).length <= 60000, 'classroom_materials_too_large');
export type ClassmateTaskInput = z.infer<typeof ClassmateTaskInputSchema>;
export const ClassroomTaskRecordSchema = z.object({
  sessionId: z.string(), id: z.string(), digest: z.string(), role: ClassmateSchema,
  task: z.string(), materials: z.array(ClassmateMaterialSchema), destination: z.enum(['conversation', 'teacher']),
  routeOverride: ClassmateRouteSchema.optional(), effectiveRoute: ClassmateRouteSchema.optional(),
  childId: z.string(), parentTurn: z.number().int().nonnegative(), fromSequence: z.number().int(),
  toSequence: z.number().int().optional(), previousTask: z.string().optional(),
  cueRef: z.string().optional(),
  canceled: z.boolean().optional(), launchError: z.string().optional(),
}).strict();
export type ClassroomTaskRecord = z.infer<typeof ClassroomTaskRecordSchema>;
export type ClassmateTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted';
/** Student projection excludes private task text and all private materials/results. */
export interface ClassroomTaskView {
  ref: string; roleId: string; name: string; purpose: string; status: ClassmateTaskStatus;
  destination: 'conversation' | 'teacher'; task: string;
  materials: { title: string; text: string }[]; reply: string; replySequence?: number;
}
export const ClassroomSessionRecordSchema = z.object({
  sessionId: z.string(), id: z.string(), sinceSequence: z.number().int(), suspended: z.boolean(),
  skipThroughSequence: z.number().int().optional(),
  pausedInput: z.string().optional(),
  /** Runtime scene state: per-lesson intimacy overrides keyed `${roleId}:${target}`.
   * Situational role-play state only; shadows the document's authored defaults. */
  intimacy: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
}).strict();
export const ClassroomCueRecordSchema = z.object({
  sessionId: z.string(), id: z.string(), trigger: z.enum(['round', 'stage']), key: z.string(),
  teacherTurn: z.number().int().nonnegative(), sequence: z.number().int(), rule: ClassroomRuleSchema,
  state: z.enum(['pending', 'delivered', 'handled', 'dismissed']),
}).strict();
export interface ClassroomChoice { id: string; title: string; enabled: boolean; roles: Classmate[] }
export interface ClassroomRuntimeView {
  tasks: ClassroomTaskView[]; completedRounds: number; suspended: boolean;
  activeEntries: { title: string; kind: 'background' | 'instruction'; scope: 'turn' | 'stage' | 'lesson' }[];
  /** Effective situational intimacy for this lesson: session override or authored default. */
  intimacy: { roleId: string; role: string; target: string; targetName: string; value: number; runtime: boolean }[];
}
