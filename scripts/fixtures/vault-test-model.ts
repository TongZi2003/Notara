import type { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, ReasoningEffortId, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { appendFile, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/** Provider route owned by the synthetic Native Vault adapter. */
export const VAULT_TEST_PROVIDER = 'notara-vault-test';
/** The single model route the synthetic adapter advertises. */
export const VAULT_TEST_MODEL = 'vault-test';
/** Second synthetic route: the provider that hosts the fixed solver's preferred model. */
export const VAULT_SOLVER_PROVIDER = 'notara-vault-solver';
/** The solver's preferred model id, exactly as the classroom contract names it. */
export const VAULT_SOLVER_MODEL = 'gpt-5.6-sol';
/** Selectable reasoning levels this route advertises, so a configured effort is provable. */
export const VAULT_SOLVER_EFFORTS: readonly string[] = ['low', 'high'];
/**
 * A different provider advertising the same model id. Off by default: it exists
 * so a test can prove the classroom refuses to guess when one model name is
 * offered twice. It is read inside the isolated DSH child process, so a test
 * sets `VAULT_SOLVER_AMBIGUOUS_ENV` before booting the runtime.
 */
export const VAULT_SOLVER_AMBIGUOUS_PROVIDER = 'notara-vault-solver-alt';
export const VAULT_SOLVER_AMBIGUOUS_ENV = 'NOTARA_VAULT_TEST_AMBIGUOUS_SOLVER';
/**
 * Reserved reply key for every request that arrives on a solver route. The
 * per-preset __worker:<preset> reply may override it. Synthetic workers can
 * attempt tools so tests exercise the real scoped restrictions, including denial.
 */
export const VAULT_SOLVER_REPLY_KEY = '__solver';

export interface VaultTestModelConfig {
  /** Append-only capture of every assembled request. Synthetic runs only. */
  logPath: string;
  /** Scripted replies keyed by the exact text of the last real user message. */
  repliesPath: string;
}

export interface ScriptedCall {
  name: string;
  arguments?: unknown;
  /** Exact model transport bytes, including intentionally malformed JSON. */
  rawArguments?: string;
  /** Synthetic transport timing for real tool-input stream acceptance. */
  chunkSize?: number;
  chunkDelayMs?: number;
}

/**
 * One scripted reply: a tool call, a call list, a natural answer, or both.
 * `pauseMs` keeps the stream open before its first chunk so a test can cancel a
 * running solver task inside a deterministic window.
 */
export type ScriptedReply = string | ScriptedCall | ScriptedCall[] | { text?: string; calls?: ScriptedCall[]; pauseMs?: number };

type Replies = Record<string, ScriptedReply>;

/** Reserved key returning the session title for `purpose: 'session-title'` calls. */
const TITLE_KEY = '__session-title';

/** Keep only well-formed scripted calls; a stray entry never becomes a request. */
function scriptedCalls(value: readonly unknown[]): ScriptedCall[] {
  const calls: ScriptedCall[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string') continue;
    calls.push({ name: record.name,
      ...(Object.hasOwn(record, 'arguments') ? { arguments: record.arguments } : {}),
      ...(typeof record.rawArguments === 'string' ? { rawArguments: record.rawArguments } : {}),
      ...(typeof record.chunkSize === 'number' ? { chunkSize: Math.max(1, record.chunkSize) } : {}),
      ...(typeof record.chunkDelayMs === 'number' ? { chunkDelayMs: Math.max(0, record.chunkDelayMs) } : {}),
    });
  }
  return calls;
}

function normalize(entry: unknown): { calls: ScriptedCall[]; text?: string; pauseMs?: number } {
  if (typeof entry === 'string') return { calls: [], text: entry };
  if (Array.isArray(entry)) return { calls: scriptedCalls(entry) };
  if (entry !== null && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    if (typeof record.name === 'string') return { calls: scriptedCalls([record]) };
    const calls = Array.isArray(record.calls) ? scriptedCalls(record.calls) : [];
    const pause = typeof record.pauseMs === 'number' && Number.isFinite(record.pauseMs) && record.pauseMs > 0 ? record.pauseMs : undefined;
    return {
      calls,
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(pause === undefined ? {} : { pauseMs: pause }),
    };
  }
  return { calls: [] };
}

async function readReplies(path: string): Promise<Replies> {
  const raw = await readFile(path, 'utf8').catch(() => '{}');
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Replies : {};
  } catch {
    return {};
  }
}

/** Provider routes this adapter serves in one run. */
export function vaultTestProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  return env[VAULT_SOLVER_AMBIGUOUS_ENV] === '1'
    ? [VAULT_TEST_PROVIDER, VAULT_SOLVER_PROVIDER, VAULT_SOLVER_AMBIGUOUS_PROVIDER]
    : [VAULT_TEST_PROVIDER, VAULT_SOLVER_PROVIDER];
}

export const inject = ['llm'];

/**
 * Opt-in synthetic adapter for Native Vault integration acceptance. It never
 * contacts a provider and never reaches the product package or real routing.
 * Scripted replies stay in the run's own data root, exactly like the isolated
 * DSH home they answer into. It serves two routes: the classroom route the
 * teacher talks on, and a second route carrying the fixed solver's model.
 */
export function apply(ctx: Context, config: VaultTestModelConfig): void {
  class VaultTestAdapter extends LlmAdapter {
    override providerRetryPolicy() { return { mode: 'normal' as const, maxRetries: 1, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 5, maxDelayMs: 5, jitterRatio: 0 }; }
    override providerInfo(provider: string) { return { id: provider, name: 'Vault 测试模型' }; }
    override async listModels(provider: string) {
      return provider === VAULT_TEST_PROVIDER
        ? [{ provider, id: VAULT_TEST_MODEL, name: 'Vault 测试模型' }]
        : [{ provider, id: VAULT_SOLVER_MODEL, name: '解题者测试模型' }];
    }
    // Vault reads PDF pages and images once a route declares the image modality.
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return {
        provider, id: model, name: model, context: { contextWindow: 128_000 }, defaultMaxTokens: 4096, systemPromptUpdate: 'in-history', inputModalities: ['text', 'image'],
        // The solver route advertises reasoning levels so a configured effort is
        // observable; the classroom route keeps the original plain metadata.
        ...(provider === VAULT_TEST_PROVIDER ? {} : { reasoning: { efforts: VAULT_SOLVER_EFFORTS.map(id => ({ id: ReasoningEffortId(id), name: id })) } }),
      };
    }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const user = options.messages.findLast(message => message.role === 'user' && message.source.kind === 'user');
      const userText = user ? user.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim() : '';
      await appendFile(config.logPath, JSON.stringify({
        sessionId: options.sessionId ?? null,
        purpose: options.purpose ?? null,
        provider: options.provider,
        model: options.model,
        reasoningEffort: options.reasoningEffort ?? null,
        maxTokens: options.maxTokens ?? null,
        messages: options.messages,
        toolSchemas: options.tools ?? [],
        at: new Date().toISOString(),
      }) + '\n');
      let workerPreset: string | undefined;
      try { const task = JSON.parse(userText); if (['problem', 'lesson', 'review', 'general', 'exercise'].includes(task.preset) && typeof task.goal === 'string') workerPreset = task.preset; } catch { /* normal teacher message */ }
      const solverRoute = workerPreset !== undefined || options.provider !== VAULT_TEST_PROVIDER;
      const replies = await readReplies(config.repliesPath);
      const scripted = normalize(workerPreset && replies[`__worker:${workerPreset}`] !== undefined ? replies[`__worker:${workerPreset}`] : replies[solverRoute ? VAULT_SOLVER_REPLY_KEY : userText]);
      const calls = scripted.calls;
      // A real user message consumes its scripted calls in order: the index is
      // how many tool calls this conversation already issued after it, never a
      // retry counter that a replayed or re-run turn could shift.
      const userAt = user ? options.messages.lastIndexOf(user) : -1;
      const issued = userAt < 0 ? 0 : options.messages.slice(userAt + 1)
        .flatMap(message => message.content)
        .filter(block => block.type === 'tool-call').length;
      const call = options.purpose ? undefined : calls[issued];
      if (call) {
        const id = ToolCallId(crypto.randomUUID()), args = call.rawArguments ?? JSON.stringify(call.arguments ?? {});
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        const size = call.chunkSize ?? args.length;
        for (let offset=0;offset<args.length;offset+=size) {
          if (call.chunkDelayMs) await delay(call.chunkDelayMs, undefined, options.signal ? { signal: options.signal } : undefined);
          yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args.slice(offset,offset+size) };
        }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      const titleEntry = replies[TITLE_KEY];
      const title = typeof titleEntry === 'string' ? titleEntry : '';
      const scriptedText = options.purpose ? undefined : scripted.text;
      const body = scriptedText ?? (options.purpose === 'session-title' ? title || userText.slice(0, 18) || 'Vault 课堂'
        : options.purpose ? `（测试模型对 ${options.purpose} 请求返回的占位文本）`
          : userText || '（测试模型收到空输入）');
      const hold = options.signal ? { signal: options.signal } : undefined;
      if (scripted.pauseMs !== undefined) await delay(scripted.pauseMs, undefined, hold);
      yield { type: 'block-start', index: 0, blockType: 'text' };
      for (let start = 0; start < body.length; start += 24) {
        await delay(5, undefined, hold);
        yield { type: 'text-delta', index: 0, text: body.slice(start, start + 24) };
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: body } };
      yield { type: 'usage', usage: { inputTokens: 8, cacheReadTokens: 2, outputTokens: 5, totalTokens: 15 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(vaultTestProviders(), new VaultTestAdapter());
}
