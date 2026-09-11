/**
 * P1.5 native capability harness.
 *
 * Mounts the real DSH services from the packages this repository installs —
 * LLM runtime, session store + projection registry (+ optional JSONL session
 * persistence), system-prompt registry, tool registry, agent registry,
 * AgentLoop, and (opt-in) subagent providers and the filesystem skill provider —
 * and registers ONE deterministic model adapter through the public
 * `LlmAdapter` / `ctx.llm.registerAdapter` seam.
 *
 * Public entry shape (import from `tests/fixtures/native-agent.ts`):
 *   mountNativeAgentHarness({ subagents?, skillDirs? }) -> NativeAgentHarness
 *     .ctx                       real Context: mount anything else on it directly
 *                                (e.g. installToolAccess(ctx, access) for P1.4)
 *     .createAgent(id, {model?})  real AgentLoop.create, published production Agent
 *     .turn(agent, text)          one user prompt, resolves at `whenIdle()`
 *     .adapter.script(sessionId|null, reply)  queue one deterministic reply
 *     .adapter.last() / .captured() / .forSession(id)  assembled requests
 *     .dispose()                  ctx.fiber.dispose() + temp-root cleanup
 *   requestText(captured)         all rendered message text for assertions
 *   tempRoot() / cleanupTempRoot()  isolated temp dirs
 *   writeSkill(root, name, {description, body, bundle?})
 * The adapter is text-'ack' by default; script a `{kind:'tool-call', name,
 * arguments}` reply when a test needs the model to call a tool.
 *
 * It is a controllable model backend, not a replacement for a native service:
 * every other seam under test is the published DSH implementation. It records
 * the fully assembled request (system prompt, tool schemas, provider/model
 * route, session id, messages), which is what lets a test assert that a dynamic
 * prompt section or a child's inherited route actually reached the wire.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, {
  LlmAdapter,
  ToolCallId,
  createUserMessage,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
// Include the native token-meter state augmentations alongside client view DTOs.
import type {} from '@deepseek-ai/dsh-token-meter';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import { apply as applyFork } from '@deepseek-ai/dsh-subagent-fork-in-process';
import { apply as applySpawn } from '@deepseek-ai/dsh-subagent-spawn-in-process';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import { apply as applySkillFilesystem } from '@deepseek-ai/dsh-skill-filesystem';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

/** Provider route the harness adapter registers. */
export const SCRIPTED_PROVIDER = 'scripted';
/** Default model id the harness adapter advertises. */
export const SCRIPTED_MODEL = 'scripted-1';

/** One deterministic model reply, either plain text or a single tool call. */
export type ScriptedReply =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'wait-for-abort' }
  | {
      readonly kind: 'tool-call';
      readonly name: string;
      /** Raw JSON arguments as the model would emit them. */
      readonly arguments: string;
    };

/** The fully assembled request the loop handed to the adapter. */
export interface CapturedRequest {
  readonly provider: string;
  readonly model: string;
  readonly sessionId: string | undefined;
  /** Rendered prompt from the latest system-role message, or ''. */
  readonly system: string;
  readonly toolNames: readonly string[];
  readonly options: GenerateOptions;
}

/** Adapter wired into the harness: record every request, reply by session script. */
class ScriptedAdapter extends LlmAdapter {
  private readonly requests: CapturedRequest[] = [];
  private readonly scripts = new Map<string, ScriptedReply[]>();
  private fallback: ScriptedReply = { kind: 'text', text: 'ack' };

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Scripted test model' };
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return [{ provider, id: SCRIPTED_MODEL, name: 'Scripted test model' }];
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128_000 },
      defaultMaxTokens: 4096,
      systemPromptUpdate: 'in-history',
    };
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId);
    const reply = this.nextReply(sessionId);
    this.requests.push({
      provider: options.provider,
      model: options.model,
      sessionId,
      system: latestSystemPrompt(options),
      toolNames: (options.tools ?? []).map(tool => tool.name),
      options,
    });
    if (reply.kind === 'wait-for-abort') {
      const signal = options.signal;
      if (!signal) throw new Error('native cancellation signal missing');
      await new Promise<never>((_resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return;
    }
    if (reply.kind === 'text') {
      yield* textChunks(reply.text);
      return;
    }
    yield* toolCallChunks(reply.name, reply.arguments);
  }

  /** Queue one reply for a session id, or the fallback when `sessionId` is null. */
  script(sessionId: string | null, reply: ScriptedReply): void {
    if (sessionId === null) {
      this.fallback = reply;
      return;
    }
    const queue = this.scripts.get(sessionId) ?? [];
    queue.push(reply);
    this.scripts.set(sessionId, queue);
  }

  /** Every assembled request in arrival order. */
  captured(): readonly CapturedRequest[] {
    return this.requests;
  }

  /** The most recent assembled request, failing loud when no model call happened. */
  last(): CapturedRequest {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error('no model request was captured');
    return request;
  }

  /** Every captured request whose session id matches, in arrival order. */
  forSession(sessionId: string): readonly CapturedRequest[] {
    return this.requests.filter(request => request.sessionId === sessionId);
  }

  private nextReply(sessionId: string | undefined): ScriptedReply {
    if (sessionId === undefined) return this.fallback;
    const queue = this.scripts.get(sessionId);
    if (queue === undefined || queue.length === 0) return this.fallback;
    return queue.shift()!;
  }
}

/** Options for {@link mountNativeAgentHarness}. */
export interface HarnessOptions {
  /** Mount the subagent service plus the in-process spawn and fork providers. */
  readonly subagents?: boolean;
  /**
   * Skill roots for the real filesystem skill provider. The provider is mounted
   * with default roots disabled so a test never reads the operator's home.
   */
  readonly skillDirs?: readonly string[];
}

/** A mounted real-DSH context plus the scripted adapter and helpers under test. */
export interface NativeAgentHarness {
  readonly ctx: Context;
  readonly adapter: ScriptedAdapter;
  /** Create one published production Agent through the real AgentLoop. */
  createAgent(id: string, options?: { provider?: string; model?: string }): Promise<Agent>;
  /** Deliver one user prompt and resolve once the agent is quiescent. */
  turn(agent: Agent, text: string): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Mount the real prerequisite services and register the scripted adapter.
 * The returned context owns every mounted service and unwinds on
 * {@link NativeAgentHarness.dispose}; the harness owns its own isolated
 * persistence root under the OS temp directory.
 */
export async function mountNativeAgentHarness(options: HarnessOptions = {}): Promise<NativeAgentHarness> {
  const owned: string[] = [];
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    if (options.subagents === true) {
      // Continuable children require a persistence backend; keep it isolated.
      const persistenceRoot = await tempRoot('sf-sessions-');
      owned.push(persistenceRoot);
      await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot });
      await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' });
    }
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    if (options.subagents === true) {
      await ctx.plugin(SubagentRuntime);
      applySpawn(ctx, { providerName: 'spawn' });
      applyFork(ctx, { providerName: 'fork' });
    }
    if (options.skillDirs !== undefined) {
      await ctx.plugin(SkillRegistry, {});
      applySkillFilesystem(ctx, {
        providerName: 'filesystem',
        includeDefaultRoots: false,
        watch: false,
        customSkillDirs: [...options.skillDirs],
      });
    }
    const adapter = new ScriptedAdapter();
    ctx.llm.registerAdapter([SCRIPTED_PROVIDER], adapter);
    return {
      ctx,
      adapter,
      createAgent: (id, agentOptions = {}) =>
        ctx.agentLoop.create(SessionId(id), { provider: SCRIPTED_PROVIDER, model: SCRIPTED_MODEL, ...agentOptions }),
      turn: async (agent, text) => {
        agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
        await agent.whenIdle();
      },
      dispose: async () => {
        await ctx.fiber.dispose();
        for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await ctx.fiber.dispose();
    for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** All rendered text from one captured request's messages, joined for assertions. */
export function requestText(request: CapturedRequest): string {
  return request.options.messages.flatMap(message => message.content).map(block => (block.type === 'text' ? block.text : '')).join('\n');
}

/**
 * Write one directory-bundle or flat Markdown skill into `root`, returning the
 * skill root path the filesystem provider should scan.
 */
export async function writeSkill(root: string, name: string, spec: {
  readonly description: string;
  readonly body: string;
  readonly bundle?: boolean;
}): Promise<string> {
  if (spec.bundle === true) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), skillMarkdown(name, spec.description, spec.body), 'utf8');
    return root;
  }
  await writeFile(join(root, `${name}.md`), skillMarkdown(name, spec.description, spec.body), 'utf8');
  return root;
}

function skillMarkdown(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

/** A temporary root that tests may fill with skills or sessions. */
export async function tempRoot(prefix = 'sf-native-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Remove a {@link tempRoot}, ignoring a missing directory. */
export async function cleanupTempRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/** The rendered prompt from the latest system-role message in one request. */
function latestSystemPrompt(options: GenerateOptions): string {
  for (let index = options.messages.length - 1; index >= 0; index -= 1) {
    const message = options.messages[index];
    if (message === undefined || message.role !== 'system') continue;
    return message.content.map(block => (block.type === 'text' ? block.text : '')).join('');
  }
  return options.system ?? '';
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...(text.length === 0 ? [] : [{ type: 'text-delta', index: 0, text } satisfies StreamChunk]),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

function toolCallChunks(name: string, args: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(`call-${name}`), name, argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`call-${name}`), name, arguments: args } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}
