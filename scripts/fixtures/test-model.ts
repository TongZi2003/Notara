import type { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeSourceFragments } from '../../packages/contracts/src/source-context.ts';

export const inject = ['llm'];
/** Opt-in isolated E2E adapter. Never part of the product package or real account routing. */
export function apply(ctx: Context, config: { logPath: string }): void {
  class ClassroomTestAdapter extends LlmAdapter {
    private readonly attempts = new Map<string, number>();
    override providerRetryPolicy() { return { mode: 'normal' as const, maxRetries: 1, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 5, maxDelayMs: 5, jitterRatio: 0 }; }
    override providerInfo(provider: string) { return { id: provider, name: '课堂测试' }; }
    override async listModels(provider: string) { return ['study-model-a', 'study-model-b'].map(id => ({ provider, id, name: id })); }
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return { provider, id: model, name: model, context: { contextWindow: 8192 }, defaultMaxTokens: 2048, systemPromptUpdate: 'in-history', inputModalities: ['text', 'image'],
        ...(model === 'study-model-a' ? { reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: '简短' }, { id: ReasoningEffortId('high'), name: '充分' }], defaultEffort: ReasoningEffortId('low') } } : {}),
      };
    }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const user = options.messages.findLast(message => message.role === 'user' && message.source.kind === 'user');
      const text = user?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? '';
      const key = `${options.purpose}:${options.sessionId}:${user?.id}`, attempt = this.attempts.get(key) ?? 0;
      this.attempts.set(key, attempt + 1);
      await appendFile(config.logPath, JSON.stringify({ sessionId: options.sessionId, purpose: options.purpose, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, messages: options.messages, toolNames: options.tools?.map(tool => tool.name) ?? [], toolSchemaBytes: Buffer.byteLength(JSON.stringify(options.tools ?? [])), at: Date.now() }) + '\n');
      const studentText = decodeSourceFragments(text).text.trim();
      let scripted = studentText.startsWith('[tools]') ? JSON.parse(studentText.slice(7)) as { name: string; arguments: unknown }[]
        : studentText.startsWith('[tool]') ? [JSON.parse(studentText.slice(6)) as { name: string; arguments: unknown }] : [];
      // UI privacy checks script teacher output outside the student's visible text.
      // These files exist only in the explicit isolated test-model runtime.
      if (!scripted.length) {
        const replies = await readFile(join(dirname(config.logPath), 'teacher-replies.json'), 'utf8')
          .then(raw => JSON.parse(raw) as Record<string, { name: string; arguments: unknown }[]>).catch(() => ({} as Record<string, { name: string; arguments: unknown }[]>));
        scripted = replies[studentText] ?? [];
      }
      // The test declares the model's replies separately from the real node
      // action. This verifies UI/Host wiring, never semantic model behavior.
      const task = decodeSourceFragments(text).fragments.findLast(fragment => fragment.bookTask)?.bookTask;
      if (task) {
        const plans = await readFile(join(dirname(config.logPath), 'book-task-replies.json'), 'utf8')
          .then(raw => JSON.parse(raw) as { action: string; nodePath?: string; calls: { name: string; arguments: unknown }[] }[]).catch(() => []);
        scripted = plans.find(plan => plan.action === (task.action ?? 'directory') && plan.nodePath === task.nodePath)?.calls ?? [];
      }
      // Native send_message arrives as an agent-attributed message rather than
      // a student's message. Script the latest explicit child directive there.
      const childDirective = options.messages.findLast(message => message.role === 'user'
        && message.content.some(block => block.type === 'text' && /\[child-tools?\]/.test(block.text)));
      const childText = childDirective?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? '';
      const childTool = !studentText.startsWith('[tool') && childText.match(/\[child-tool\](\{[^\n]+\})/);
      const childTools = !studentText.startsWith('[tool') && childText.match(/\[child-tools\](\[[^\n]+\])/);
      if (childTool) scripted = [JSON.parse(childTool[1]!) as { name: string; arguments: unknown }];
      if (childTools) scripted = JSON.parse(childTools[1]!) as { name: string; arguments: unknown }[];
      if (studentText.includes('[structured-problem]') && options.tools?.some(tool => tool.name === 'structured_output')) scripted = [{ name: 'structured_output',
        arguments: { problems: [{ title: '独立命题样题', front: '求 $2+3$。', solution: '5', notes: '', tags: [] }] },
      }];
      const taskStep = task ? options.messages.slice(options.messages.lastIndexOf(user!) + 1)
        .flatMap(message => message.content).filter(block => block.type === 'tool-call').length
        : (childTool || childTools) && childDirective ? options.messages.slice(options.messages.indexOf(childDirective) + 1)
          .flatMap(message => message.content).filter(block => block.type === 'tool-call').length : attempt;
      let call = scripted[taskStep];
      // Explicit receipt scenario: after confirmation the teacher reads its
      // lesson once. This exercises actual dispatch, not just a tool-name list.
      if (studentText.includes('[receipt-readback]')) {
        const noticeAt = options.messages.findLastIndex(message => message.role === 'user' && message.source.kind === 'plugin' && message.source.plugin === 'studyforge');
        const userAt = options.messages.findLastIndex(message => message === user);
        if (noticeAt > userAt) {
          const read = options.messages.slice(noticeAt + 1).some(message => message.content.some(block => block.type === 'tool-call' && block.name === 'read_lesson'));
          call = read ? undefined : { name: 'read_lesson', arguments: {} };
        }
      }
      if (call && options.purpose !== 'session-title') {
        const id = ToolCallId(crypto.randomUUID()), args = JSON.stringify(call.arguments);
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      if (text.includes('[error]')) throw new Error('isolated model request failure');
      const body = options.purpose === 'session-title' ? '一次函数学习' : text.includes('[notebook-table]') ? [
        '先按共同动作整理，表格的每一列都应留在纸面里。',
        '| 角 | 值 |\n| --- | --- |\n| 零 | 一 |',
        '| 节点 | 题号 | 页 | 共同动作 |\n| --- | --- | --- | --- |\n| 配角与凑角（结构变形、系数调整） | 4、5、7、8、9、10、11 | 1–2 | 把已知和所求凑成同一个角或其倍数，再检查象限。 |\n| 结构证明与给值求角 | 12、13、14、15 | 2–3 | 先证恒等式，再根据条件确定角的范围。 |',
        '| 一 | 二 | 三 | 四 | 五 | 六 | 七 | 八 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 和差公式 | 二倍角 | 降幂公式 | 弦切互化 | 象限条件 | 等价变形 | 共同动作 | 最后核对 |',
        '表格之后的文字继续沿着同一张纸阅读。',
      ].join('\n\n') : text.includes('[markdown]') ? '# 分式与条件\n\n先看 $x\\ne 0$。\n\n$$\\frac{x^2}{x}=x$$\n\n```text\n先检查条件\n```\n\n' + '阅读后请写出下一步。\n\n'.repeat(35) : `已收到：${decodeSourceFragments(text).text}`;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'usage', usage: { inputTokens: 8, cacheReadTokens: 2, outputTokens: 2 } };
      if (text.includes('[retry]') && attempt === 0) {
        yield { type: 'text-delta', index: 0, text: '开始计算' };
        yield { type: 'usage', usage: { inputTokens: 8, cacheReadTokens: 2, outputTokens: 5, totalTokens: 15 } };
        throw new LlmError('isolated retryable response', 'RATE_LIMIT');
      }
      for (let start = 0; start < body.length; start += 8) {
        await delay(text.includes('[slow]') ? 200 : 5, undefined, { ...(options.signal ? { signal: options.signal } : {}) });
        yield { type: 'text-delta', index: 0, text: body.slice(start, start + 8) };
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: body } };
      const outputTokens = text.includes('[retry]') ? 3 : 5;
      yield { type: 'usage', usage: { inputTokens: 8, cacheReadTokens: 2, outputTokens, reasoningTokens: 3, ...(text.includes('[partial]') ? {} : { totalTokens: 10 + outputTokens }) } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['studyforge-test'], new ClassroomTestAdapter());
}
