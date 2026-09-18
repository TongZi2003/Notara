import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { toolSchema } from './tool-schema.ts';
import { teacherContext } from './learning-context.ts';
import { entityReferenceContent } from './entity-reference-output.ts';
import {
  RoundAnswerInputSchema, RoundOpenInputSchema, RoundRefInputSchema, TeachingRoundViewSchema,
} from '@studyforge/contracts/teaching-rounds';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

/**
 * The model-facing round verbs. `round_open` starts a persisted teaching
 * round: an isolated problem helper writes the question (registered as a real
 * card by the Host), the student answers in their own turn, a peer reviews the
 * answer without the standard, and an assistant corrects against it. The
 * student drives their answer and the correction request from the rounds
 * panel; these verbs let the teacher open, relay, advance, read and stop a
 * round without ever speaking for a helper.
 */
export function registerRoundTools(host: Context): void {
  const register = <I extends z.ZodType>(name: string, description: string, input: I,
    run: (args: z.output<I>, execution: ToolRunContext) => Promise<unknown>): void => {
    host.effect(() => host.tools.register({
      name, description, parameters: toolSchema(input),
      output: { schema: toolSchema(TeachingRoundViewSchema), render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(TeachingRoundViewSchema.parse(value)) }, ...entityReferenceContent(value)] },
      async execute(args: unknown, execution: ToolRunContext) { return run(input.parse(args), execution); },
    }));
  };

  register('round_open',
    '开一轮多角色教学回合：命题帮手出题（Host校验后登记为真实题卡）→ 学生在回合面板写下自己的作答 → 同伴评审（只见材料与学生原话，不见标准）→ 助教按参考标准勘误。materials是帮手唯一可依据的材料原文，standard是勘误依据（学生不可见）。出题失败时回合如实记为失败，不自己补写题目。',
    RoundOpenInputSchema,
    async (input, execution) => host.notaraRounds.open(await teacherContext(host, execution), input, execution.signal));

  register('round_read',
    '读取一轮教学回合的当前状态：阶段、题面、学生作答与各角色原话。',
    RoundRefInputSchema,
    async (input, execution) => host.notaraRounds.read(await teacherContext(host, execution), input.ref));

  register('round_answer',
    '把学生自己写下的作答送入回合：记录原话并让同伴评审。学生也可直接在回合面板提交，两边写进同一份记录；重复提交按阶段拒绝。',
    RoundAnswerInputSchema,
    async (input, execution) => host.notaraRounds.answer(await teacherContext(host, execution), input.ref, input.text, execution.signal));

  register('round_correct',
    '推进到勘误阶段：助教按参考标准核对学生作答，返回其原话。同伴评审失败不阻塞勘误。',
    RoundRefInputSchema,
    async (input, execution) => host.notaraRounds.correct(await teacherContext(host, execution), input.ref, execution.signal));

  register('round_stop',
    '停止进行中的教学回合：打断仍在运行的帮手，回合如实记为已停止。',
    RoundRefInputSchema,
    async (input, execution) => host.notaraRounds.stop(await teacherContext(host, execution), input.ref));
}
