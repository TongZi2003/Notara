/**
 * 番茄钟 over the real HTTP Host: the classroom timer is started through the
 * plugin's own remote methods, the Host arms its timer, and when the phase ends
 * the native agent receives one plugin follow-up that opens a teacher turn. The
 * scripted model records the request it actually received, so "the teacher was
 * woken by the timer" and "the student gained no message of their own" are read
 * from the assembled request.
 */
import { afterEach, expect, test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, type VaultHarness } from '../fixtures/vault-http.ts';

interface PomodoroView { state: 'running' | 'idle'; phase?: string; minutes?: number; endsAt?: string; remainingMs?: number; now: string; last: null | { phase: string; outcome: string } }

let runtime: VaultRuntime | undefined;
let harness: VaultHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await runtime?.stop();
  runtime = undefined;
});

test('番茄钟到点后原生 follow-up 唤醒空闲的老师主动开口；学生没有多出自己的消息', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const session = await harness.createSession();
  await writeFile(join(harness.root, 'teacher-replies.json'), `${JSON.stringify({ '先开始上课': '好，我们开始。' })}\n`);
  await harness.ask(session, '先开始上课');

  const refused = await harness.rpc('notaraVault/startPomodoro', { input: { sessionId: session, phase: 'focus', minutes: 500 } });
  expect(refused.ok).toBe(false);
  const started = harness.value(await harness.rpc<PomodoroView>('notaraVault/startPomodoro', { input: { sessionId: session, phase: 'break', minutes: 1 } }));
  expect(started.state).toBe('running');
  expect(started.phase).toBe('break');
  expect(started.remainingMs).toBeGreaterThan(55_000);

  const woken = async () => (await harness!.requests()).some(row => row.sessionId === session && !row.purpose
    && row.messages.some(message => message.source?.kind === 'notara-pomodoro'));
  await expect.poll(woken, { timeout: 120_000, interval: 2_000 }).toBe(true);

  const status = harness.value(await harness.rpc<PomodoroView>('notaraVault/pomodoro', { input: { sessionId: session } }));
  expect(status.state).toBe('idle');
  expect(status.last).toMatchObject({ phase: 'break', outcome: 'finished' });

  const wake = (await harness.requests()).filter(row => row.sessionId === session && !row.purpose).at(-1)!;
  const notice = wake.messages.find(message => message.source?.kind === 'notara-pomodoro');
  expect(notice?.role).toBe('user');
  // Session format v4: the producer names its own source kind (no `plugin` wrapper).
  expect(notice?.source?.form).toBe('notice');
  expect(notice?.content.map(block => block.text ?? '').join('')).toContain('主动开口');
  // Only the one message the student typed is theirs.
  expect(wake.messages.filter(message => message.role === 'user' && message.source?.kind === 'user')).toHaveLength(1);
  // One phase, one wake: a later status read does not deliver again.
  harness.value(await harness.rpc<PomodoroView>('notaraVault/pomodoro', { input: { sessionId: session } }));
  const notices = (await harness.requests()).filter(row => row.sessionId === session && !row.purpose)
    .at(-1)!.messages.filter(message => message.source?.kind === 'notara-pomodoro');
  expect(notices).toHaveLength(1);
}, 300_000);
