import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { type ClassroomChoice, type ClassroomRuntimeView, ClassmateTaskInputSchema } from '@studyforge/contracts/classroom';
import { WorldbookEntrySchema } from '@studyforge/contracts/plugins';
import { studentContext } from './learning-service.ts';
import { teacherContext } from './tools/learning-context.ts';
import { toolSchema } from './tools/tool-schema.ts';

const Target = z.object({ sessionId: z.string().min(1), id: z.string().min(1) }).strict();
export class ClassroomRemote extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'notaraClassroomView'); }
  @Remote('choices')
  async choices(input: { sessionId: string }): Promise<ClassroomChoice[]> {
    await studentContext(this.ctx, input.sessionId); return this.ctx.notaraClassroom.choices(input.sessionId);
  }
  @Remote('read')
  async read(input: { sessionId: string; id: string }): Promise<ClassroomRuntimeView> {
    const data = Target.parse(input); await studentContext(this.ctx, data.sessionId); return this.ctx.notaraClassroom.view(data.sessionId, data.id);
  }
  @Remote('stop')
  async stop(input: { sessionId: string; id: string; ref?: string }): Promise<ClassroomRuntimeView> {
    const data = Target.extend({ ref: z.string().optional() }).parse(input), context = await studentContext(this.ctx, data.sessionId);
    await this.ctx.notaraClassroom.definition(data.sessionId, data.id);
    if (data.ref) {
      const task = this.ctx.notaraClassroom.tasks.read(context, data.ref); if (task.data.id !== data.id) throw new Error('classroom_task_owner');
      await this.ctx.notaraClassroom.stopTask(context, data.ref);
    } else await this.ctx.notaraClassroom.stopAll(data.sessionId, data.id);
    return this.ctx.notaraClassroom.view(data.sessionId, data.id);
  }
}

export function registerClassroomTools(host: Context): void {
  const output = { schema: toolSchema(z.object({ json: z.string() })), render: (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }] };
  const read = z.object({ id: z.string().optional() }).strict();
  host.effect(() => host.tools.register({ name: 'read_classroom', description: '读取教室、同学、世界书和真实任务状态。省略id列出本课教室；提供id查看配置revision、任务和同学回复。私有备课只给老师，公开回复由系统署名展示。', parameters: toolSchema(read), output,
    async execute(args, execution) {
      const context = await teacherContext(host, execution), data = read.parse(args);
      if (!data.id) return { json: JSON.stringify(await host.notaraClassroom.choices(context.sessionId!)) };
      return { json: JSON.stringify({ ...await host.notaraClassroom.definition(context.sessionId!, data.id), ...await host.notaraClassroom.view(context.sessionId!, data.id, true) }) };
    },
  }));
  host.effect(() => host.tools.register({ name: 'ask_classmate', description: '由老师向本课已启用的同学派发独立任务。先自己读取并选择材料；同学无工具、不继承父会话。返回真实任务引用后等待原生完成通知，不重复派发。公开任务只提供可公开材料；含解答/标准的备课选teacher。', parameters: toolSchema(ClassmateTaskInputSchema), output,
    async execute(args, execution) {
      const context = await teacherContext(host, execution);
      return { json: JSON.stringify(await host.notaraClassroom.request(context, execution.agent!, ClassmateTaskInputSchema.parse(args))) };
    },
  }));
  const follow = z.object({ ref: z.string().regex(/^classroomtask:[a-f0-9]{64}$/).describe('read_classroom或ask_classmate返回的本课任务ref。'), question: z.string().trim().min(1).max(8000).describe('在原任务与材料边界内继续追问。旧材料仍在；需要更换边界、公开原私有任务或跨课时改用ask_classmate新建。') }).strict();
  host.effect(() => host.tools.register({ name: 'continue_classmate', description: '继续同一课堂、同一任务的原子会话，保留旧材料和原回复去向。不会使同学遗忘旧信息；换任务边界必须新建。', parameters: toolSchema(follow), output,
    async execute(args, execution) { const context = await teacherContext(host, execution), data = follow.parse(args); return { json: JSON.stringify(await host.notaraClassroom.continueTask(context, execution.agent!, data.ref, data.question)) }; },
  }));
  const edit = z.object({ id: z.string().min(1), expectedVersion: z.number().int().nonnegative().describe('刚才read_classroom返回的revision。'), entries: z.array(WorldbookEntrySchema).max(60).describe('更新后的完整条目列表，保留未改的条目。只改世界书内容，不改变同学或调度规则。') }).strict();
  host.effect(() => host.tools.register({ name: 'update_classroom_context', description: '与学生共建世界书条目。先read_classroom读取内容与revision，保留未改条目；更新背景或教法提示，不改变角色、规则或学情。冲突先重读，不覆盖学生的并发编辑。', parameters: toolSchema(edit), output,
    async execute(args, execution) { const context = await teacherContext(host, execution), data = edit.parse(args); return { json: JSON.stringify(await host.notaraClassroom.writeContext(context, data.id, data.expectedVersion, data.entries)) }; },
  }));
}
