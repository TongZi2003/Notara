/**
 * P1.5 live capability lane.
 *
 * Two levels, kept explicit:
 *  - Provider assembly: the real installed web adapters are mounted through
 *    the published `ctx.web` seam and the real tool row, proving which
 *    providers the product composition actually gets. This is deterministic
 *    and runs everywhere.
 *  - Real retrieval: one live search plus one live fetch, kept only when the
 *    external credential is present. Without `DEEPSEEK_API_KEY` both are
 *    reported BLOCKED with a skip reason; the lane never fabricates a success
 *    from package presence alone.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import WebRuntime from '@deepseek-ai/dsh-web';
import { apply as applyWebFetchHttp } from '@deepseek-ai/dsh-web-fetch-http';
import { apply as applyWebSearchDeepSeek } from '@deepseek-ai/dsh-web-search-deepseek';
import { apply as applyToolWeb, Config as toolWebConfig, inject as toolWebInject } from '@deepseek-ai/dsh-tool-web';
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek';
import { mountNativeAgentHarness } from '../fixtures/native-agent.ts';

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
});

/** True when the only credential the DeepSeek search adapter reads is present. */
function hasSearchCredential(): boolean {
  const key = process.env.DEEPSEEK_API_KEY;
  return key !== undefined && key.trim().length > 0;
}

const BLOCKED_REASON = 'BLOCKED without DEEPSEEK_API_KEY: search then fetch; anonymous fetch is checked separately.';

async function mountWeb(searchProvider = 'deepseek-official'): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(WebRuntime, { searchProvider, fetchProvider: 'http' });
  // ToolRuntime injects the system-prompt registry; mount it first so the
  // tool plugin actually activates instead of waiting on an absent service.
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, {});
  applyWebSearchDeepSeek(ctx, { apiKeyEnv: 'DEEPSEEK_API_KEY' });
  // The HTTP fetch provider requires explicit finite limits; these mirror the
  // shipped tool's cooperative budgets rather than inventing new ones.
  applyWebFetchHttp(ctx, { maxResponseBytes: 2_000_000, maxBodyChars: 200_000, timeoutMs: 30_000, maxRedirects: 5 });
  // A direct `apply` does not materialize schema defaults, so the tool row is
  // mounted as the real plugin, exactly as the product composition does.
  await ctx.plugin({ name: 'tool-web', inject: [...toolWebInject], apply: applyToolWeb, Config: toolWebConfig }, { fetch: true, search: true });
  return ctx;
}

describe('web provider assembly (deterministic)', () => {
  test('the product row registers deepseek search plus http fetch and exposes both tools', async () => {
    const ctx = await mountWeb();
    const tools = ctx.tools.schemas().map(tool => tool.name);
    expect(tools).toContain('web_search');
    expect(tools).toContain('web_fetch');
    // A configured provider that is not registered must fail loud, not fall back.
    const misconfigured = await mountWeb('unregistered-test-provider');
    await expect(misconfigured.web.search({ query: '三角函数 正弦定理' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' });
  });
});

describe('real retrieval (external credential required)', () => {
  test('anonymous native HTTP fetch retains a real URL and truncation fact', async () => {
    const ctx = await mountWeb();
    const fetched = await ctx.web.fetch({ url: 'https://example.com/' }, AbortSignal.timeout(30_000));
    expect(fetched.statusCode).toBe(200);
    expect(fetched.url).toBe('https://example.com/');
    expect(typeof fetched.truncated).toBe('boolean');
    expect(JSON.stringify(fetched.body)).toContain('Example Domain');
  });
  test.skipIf(!hasSearchCredential())(
    `one real search followed by one real fetch · ${BLOCKED_REASON}`,
    async () => {
      const ctx = await mountWeb();
      const search = await ctx.web.search({ query: '正弦定理 定义', maxResults: 3 });
      expect(search.sources.length).toBeGreaterThan(0);
      const first = search.sources[0];
      expect(first?.url).toMatch(/^https?:\/\//);

      const fetched = await ctx.web.fetch({ url: first?.url ?? '' });
      expect(typeof fetched.statusCode).toBe('number');
      expect(fetched.url).toMatch(/^https?:\/\//);
      // Truncation is a real provider fact; the seam reports it rather than hiding it.
      expect(typeof fetched.truncated).toBe('boolean');
    },
  );
  test.skipIf(!hasSearchCredential())('real model: a changed prompt reaches the next turn and a native child completes', async () => {
    const harness = await mountNativeAgentHarness({ subagents: true });
    try {
      await harness.ctx.plugin(DeepSeek, { apiKeyEnv: 'DEEPSEEK_API_KEY', thinking: 'disabled', maxTokens: 256, streamIdleTimeoutMs: 30_000 });
      const model = process.env.STUDYFORGE_LIVE_MODEL ?? 'deepseek-v4.1-flash';
      const parent = await harness.createAgent('live-parent', { provider: 'deepseek-official', model });
      let mark = 'alpha';
      parent.ctx.systemPrompt.section({ name: 'live-instruction', order: 20000, text: () => `Reply with only the marker ${mark}.` });
      const captured: { sessionId?: string; messages: string }[] = [];
      harness.ctx.on('llm/stream', (options, next) => {
        captured.push({ ...(options.sessionId ? { sessionId: String(options.sessionId) } : {}), messages: JSON.stringify(options.messages) });
        return next();
      });
      await harness.turn(parent, '开始');
      mark = 'beta';
      await harness.turn(parent, '继续');
      const parentCalls = captured.filter(call => call.sessionId === parent.session.id);
      expect(parentCalls.length).toBeGreaterThanOrEqual(2);
      expect(parentCalls.at(-1)?.messages).toContain('marker beta');
      const run = await harness.ctx.subagents.start('spawn', { label: '检索说明', parent, prompt: [{ type: 'text', text: '用一句中文说明为什么学习引用要保留原文来源。' }], signal: AbortSignal.timeout(45_000) });
      try {
        const result = await run.result;
        expect(result.stopReason).toBe('completed');
        expect(result.output.length).toBeGreaterThan(0);
        expect(captured.some(call => call.sessionId === run.id)).toBe(true);
      } finally { await run.dispose(); }
    } finally { await harness.dispose(); }
  });
});
