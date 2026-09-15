import { z } from 'zod';

const Key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const ClassroomAvatarRefSchema = z.string().regex(/^avatar:[a-f0-9]{64}$/);
export interface ClassroomAvatarImage { ref: string; mediaType: 'image/webp'; base64: string }
export function classmateMention(name: string, classroom: string): string { return '@' + name + '（' + classroom + '）'; }
export const ClassmateSchema = z.object({
  id: Key, name: z.string().trim().min(1).max(32), purpose: z.string().trim().min(1).max(160),
  instructions: z.string().trim().min(1).max(4000), enabled: z.boolean(),
  avatar: ClassroomAvatarRefSchema.optional().describe('通过本地头像上传得到的引用；改写角色时保留，不自行编造或写图片数据。'),
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
}).strict().superRefine((value, ctx) => {
  for (const key of ['roles', 'rules'] as const) if (new Set(value[key].map(item => item.id)).size !== value[key].length) {
    ctx.addIssue({ code: 'custom', path: [key], message: 'classroom_duplicate_id' });
  }
  if (new Set(value.roles.map(item => item.name)).size !== value.roles.length) ctx.addIssue({ code: 'custom', path: ['roles'], message: 'classroom_duplicate_name' });
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
}).strict().refine(value => JSON.stringify(value.materials).length <= 60000, 'classroom_materials_too_large');
export type ClassmateTaskInput = z.infer<typeof ClassmateTaskInputSchema>;
export const ClassroomTaskRecordSchema = z.object({
  sessionId: z.string(), id: z.string(), digest: z.string(), role: ClassmateSchema,
  task: z.string(), materials: z.array(ClassmateMaterialSchema), destination: z.enum(['conversation', 'teacher']),
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
}
