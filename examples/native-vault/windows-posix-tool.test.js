import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ShellExecutor } from '@deepseek-ai/dsh-shell';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env';
import { apply } from './windows-posix-tool.js';

test('the Windows ash adapter changes teacher guidance while retaining native tool execution and other agents', async () => {
  const ctx = new Context();
  const calls = [];
  class Shell extends ShellExecutor {
    resolve(request) { return { ...request, timeoutMs: request.timeoutMs ?? 60000 }; }
    async execute(spec) {
      calls.push(spec);
      return { done: Promise.resolve(), result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: spec.timeoutMs, stdout: { text: 'native-execution', truncated: false }, stderr: { text: '', truncated: false } }) };
    }
  }
  new Shell(ctx);
  new SystemPrompt(ctx, { includeHarnessIdentity: true, includeRuntimeContext: true });
  new ToolRuntime(ctx, { mode: 'native' });
  new ShellEnvRegistry(ctx, { dshHome: '/synthetic/notara-tool-test' });
  try {
    apply(ctx);
    const native = ctx.tools.schemas().find(tool => tool.name === 'bash');
    const agent = preset => ({ session: { header: { id: `schema-${preset}`, cwd: process.cwd(), origin: 'user', agentPreset: preset } } });
    const teacher = agent('notara-teacher');
    const teacherTool = (await ctx.systemPrompt.assemble({ agent: teacher })).tools.find(tool => tool.name === 'bash');
    assert.match(teacherTool.description, /BusyBox ash/);
    assert.match(teacherTool.description, /POSIX/);
    assert.doesNotMatch(teacherTool.description, /bash -c/);
    assert.deepEqual(teacherTool.parameters.required, native.parameters.required);
    for (const [name, schema] of Object.entries(native.parameters.properties)) {
      if (name !== 'command') assert.deepEqual(teacherTool.parameters.properties[name], schema);
    }
    const ordinaryTool = (await ctx.systemPrompt.assemble({ agent: agent('standard') })).tools.find(tool => tool.name === 'bash');
    assert.deepEqual(ordinaryTool, native);
    const result = await ctx.tools.execute({ name: 'bash', callId: 'native-ash-adapter', arguments: { command: "printf '%s' '中文 $literal'", description: '[notara:material-read] 核对当前资料', workdir: '.' }, agent: teacher, signal: new AbortController().signal });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.content), /native-execution/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "printf '%s' '中文 $literal'");
    assert.equal(calls[0].dshEnv.DSH_SESSION_ID, 'schema-notara-teacher');
  } finally { await ctx.fiber.dispose(); }
});
