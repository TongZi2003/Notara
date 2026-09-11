/**
 * P1.5 deterministic capability wiring.
 *
 * Asserts, against the real DSH services this repository installs, that the
 * StudyForge host can consume the natively available seams instead of growing
 * its own managers: dynamic system-prompt sections evaluated at each assembly,
 * the filesystem skill provider, and native subagent start/continuable/cancel/
 * outputSchema with parent/child route and tool inheritance.
 *
 * The only substitute is the model backend: a scripted `LlmAdapter` registered
 * through `ctx.llm.registerAdapter`. Every other service is the published DSH
 * implementation, and the fixture records the assembled request so the
 * assertions read what the provider actually received.
 */

import { afterEach, describe, expect, test } from 'vitest';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  SCRIPTED_MODEL,
  SCRIPTED_PROVIDER,
  cleanupTempRoot,
  mountNativeAgentHarness,
  requestText,
  tempRoot,
  writeSkill,
  type NativeAgentHarness,
} from '../fixtures/native-agent.ts';

const harnesses: NativeAgentHarness[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) await harness.dispose();
  for (const root of roots.splice(0).reverse()) await cleanupTempRoot(root);
});

async function tracked<T extends NativeAgentHarness>(harness: T): Promise<T> {
  harnesses.push(harness);
  return harness;
}

function textOf(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : '')).join('');
}

describe('dynamic system prompt and native skills', () => {
  test('a runtime prompt section is evaluated for every prepared request', async () => {
    const harness = await tracked(await mountNativeAgentHarness());
    const agent = await harness.createAgent('wiring-prompt');
    let taught = '第一版教法';
    agent.ctx.systemPrompt.section({
      name: 'studyforge:teaching',
      order: 20000,
      text: () => `本课教法：${taught}`,
    });

    await harness.turn(agent, '开始');
    expect(harness.adapter.last().system).toContain('本课教法：第一版教法');

    taught = '第二版教法';
    await harness.turn(agent, '换成第二种讲法');
    const changed = harness.adapter.last();
    expect(changed.system).toContain('本课教法：第二版教法');
    expect(changed.system).not.toContain('第一版教法');
    expect(changed.sessionId).toBe('wiring-prompt');
  });

  test('the filesystem skill provider lists and loads a real skill directory', async () => {
    const root = await tempRoot();
    roots.push(root);
    await writeSkill(root, 'fraction-review', {
      description: '分数复习讲法',
      body: '# 分数复习\n\n只切一小步，先让学生自己说下一步。',
      bundle: true,
    });
    const harness = await tracked(await mountNativeAgentHarness({ skillDirs: [root] }));
    const summaries = await harness.ctx.skills.list({ cwd: root });
    const listed = summaries.find(skill => skill.name === 'fraction-review');
    expect(listed).toMatchObject({ name: 'fraction-review', provider: 'filesystem' });

    const loaded = await harness.ctx.skills.get('fraction-review', { cwd: root });
    expect(loaded?.content).toContain('先让学生自己说下一步');
  });
});

describe('native subagents', () => {
  test('one-shot start publishes a child whose identity and route match the parent', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, { kind: 'text', text: '子任务结果' });
    const parent = await harness.createAgent('parent-one');

    const run = await harness.ctx.subagents.start('spawn', {
      label: '搜索',
      prompt: [{ type: 'text', text: '找一下正弦定理' }],
      parent,
      signal: new AbortController().signal,
    });
    const result = await run.result;
    expect(result.stopReason).toBe('completed');
    expect(textOf(result.output)).toBe('子任务结果');
    expect(run.localAgent?.session.header.parentSession).toBe(parent.session.id);
    expect(run.id).toBe(run.localAgent?.session.id);

    const childRequest = harness.adapter.captured().find(request => request.sessionId === String(run.id));
    expect(childRequest?.provider).toBe(SCRIPTED_PROVIDER);
    expect(childRequest?.model).toBe(SCRIPTED_MODEL);
    await run.dispose();
  });

  test('agentOptions and persona reach the child composition, not the parent request', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, { kind: 'text', text: 'ok' });
    const parent = await harness.createAgent('parent-options');
    // The child gets a fresh flat registration scope (the driver's documented
    // isolation), so an agent-scoped contribution must NOT leak into it. A
    // context-level tool, by contrast, is part of the child's own environment.
    parent.ctx.systemPrompt.section({ name: 'studyforge:parent-rule', order: 20100, text: '先问下一步，不直接给答案。' });
    const scopedTool = defineTool({
      name: 'studyforge_note',
      description: '记下这条教学观察',
      parameters: { text: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) { return `记录：${args.text}`; },
    });
    // Registered through the harness context so the child's fresh scope sees it.
    harness.ctx.tools.register(scopedTool);

    const run = await harness.ctx.subagents.start('spawn', {
      label: '命题',
      prompt: [{ type: 'text', text: '出两道题' }],
      parent,
      signal: new AbortController().signal,
      agentOptions: { model: 'child-model' },
      persona: '你是命题助教，只出题不讲解。',
    });
    const result = await run.result;
    expect(result.stopReason).toBe('completed');
    const childRequest = harness.adapter.captured().find(request => request.sessionId === String(run.id));
    expect(childRequest?.model).toBe('child-model');
    expect(childRequest?.system).toContain('你是命题助教，只出题不讲解。');
    // Agent-scoped parent prompt text stays in the parent scope, not the child.
    expect(childRequest?.system).not.toContain('先问下一步，不直接给答案。');
    expect(childRequest?.toolNames).toContain('studyforge_note');
    expect(harness.adapter.forSession('parent-options')).toHaveLength(0);
    await run.dispose();
  });

  test('outputSchema returns the validated structured output the child captured', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, {
      kind: 'tool-call',
      name: 'structured_output',
      arguments: JSON.stringify({ title: '正弦定理', difficulty: 3 }),
    });
    const parent = await harness.createAgent('parent-schema');

    const run = await harness.ctx.subagents.start('spawn', {
      label: '结构化出题',
      prompt: [{ type: 'text', text: '出一道题' }],
      parent,
      signal: new AbortController().signal,
      outputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, difficulty: { type: 'number' } },
        required: ['title', 'difficulty'],
        additionalProperties: false,
      },
    });
    const result = await run.result;
    expect(result.stopReason).toBe('completed');
    expect(result.structured).toEqual({ title: '正弦定理', difficulty: 3 });
    await run.dispose();
  });

  test('a continuable child accepts a later message and an interrupt', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, { kind: 'text', text: '继续中' });
    const parent = await harness.createAgent('parent-continuable');

    const started = await harness.ctx.subagents.startContinuable({
      provider: 'spawn',
      label: '持续出题',
      request: { prompt: [{ type: 'text', text: '继续出题' }], parent },
      signal: new AbortController().signal,
    });
    const childId = started.childId as SessionId;
    // The manager reserves a durable id and returns the accepted prompt's id.
    expect(started.messageId).toBeTypeOf('string');
    await expect.poll(() => harness.adapter.forSession(String(childId)).length).toBe(1);
    // The next actual request remains in flight until native interrupt reaches
    // its adapter signal. Interrupting an already idle child proves nothing.
    harness.adapter.script(String(childId), { kind: 'wait-for-abort' });

    const messageId = await harness.ctx.subagents.sendMessage(parent, childId, [{ type: 'text', text: '再来一道' }], {
      signal: new AbortController().signal,
    });
    expect(messageId).toBeTypeOf('string');
    // A second, appended turn proves the child stayed continuable rather than one-shot.
    const deadline = Date.now() + 5_000;
    while (harness.adapter.forSession(String(childId)).length < 2 && Date.now() < deadline) {
      await new Promise(resolveTick => setTimeout(resolveTick, 10));
    }

    harness.ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: parent });
    await harness.ctx.subagents.drainContinuableChildren(parent, [childId]);

    const childRequests = harness.adapter.forSession(String(childId));
    expect(childRequests.length).toBeGreaterThanOrEqual(2);
    expect(requestText(childRequests[childRequests.length - 1]!)).toContain('再来一道');
    expect(harness.ctx.subagents.list()).toEqual(['spawn', 'fork']);
  });

  test('a fork child inherits the parent route while a spawn child starts fresh', async () => {
    const harness = await tracked(await mountNativeAgentHarness({ subagents: true }));
    harness.adapter.script(null, { kind: 'text', text: '父亲上下文之后的回答' });
    const parent = await harness.createAgent('parent-inherit', { model: 'parent-model' });
    await harness.turn(parent, '我们已经讲了正弦定理');

    const run = await harness.ctx.subagents.start('fork', {
      label: '承接',
      prompt: [{ type: 'text', text: '接着讲余弦定理' }],
      parent,
      signal: new AbortController().signal,
    });
    const result = await run.result;
    expect(result.stopReason).toBe('completed');
    const childRequest = harness.adapter.captured().find(request => request.sessionId === String(run.id));
    expect(childRequest?.model).toBe('parent-model');
    expect(childRequest === undefined ? '' : requestText(childRequest)).toContain('我们已经讲了正弦定理');
    await run.dispose();
  });
});
