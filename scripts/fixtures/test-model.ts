import type { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmError, ReasoningEffortId, type GenerateOptions, type StreamChunk, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export const inject = ['llm'];
/** Opt-in isolated E2E adapter. Never part of the product package or real account routing. */
export function apply(ctx: Context, config: { logPath: string }): void {
  class ClassroomTestAdapter extends LlmAdapter {
    private readonly attempts = new Map<string, number>();
    override providerRetryPolicy() { return { mode: 'normal' as const, maxRetries: 1, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 5, maxDelayMs: 5, jitterRatio: 0 }; }
    override providerInfo(provider: string) { return { id: provider, name: '课堂测试' }; }
    override async listModels(provider: string) { return ['study-model-a', 'study-model-b'].map(id => ({ provider, id, name: id })); }
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return { provider, id: model, name: model, context: { contextWindow: 8192 }, defaultMaxTokens: 2048, systemPromptUpdate: 'in-history',
        ...(model === 'study-model-a' ? { reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: '简短' }, { id: ReasoningEffortId('high'), name: '充分' }], defaultEffort: ReasoningEffortId('low') } } : {}),
      };
    }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const user = options.messages.findLast(message => message.role === 'user' && message.source.kind === 'user');
      const text = user?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? '';
      const key = `${options.sessionId}:${user?.id}`, attempt = this.attempts.get(key) ?? 0;
      this.attempts.set(key, attempt + 1);
      await appendFile(config.logPath, JSON.stringify({ sessionId: options.sessionId, purpose: options.purpose, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, messages: options.messages, at: Date.now() }) + '\n');
      if (text.includes('[error]')) throw new Error('isolated model request failure');
      const body = options.purpose === 'session-title' ? '一次函数学习' : text.includes('[markdown]') ? '# 分式与条件\n\n先看 $x\\ne 0$。\n\n$$\\frac{x^2}{x}=x$$\n\n```text\n先检查条件\n```\n\n' + '阅读后请写出下一步。\n\n'.repeat(35) : `已收到：${text}`;
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
