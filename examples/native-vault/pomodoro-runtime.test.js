import assert from 'node:assert/strict';
import test from 'node:test';
import { Session } from '@deepseek-ai/dsh-session';
import { POMODORO_EVENT } from './pomodoro-data.js';
import { POMODORO_STALE_MS, createPomodoroRuntime } from './pomodoro-runtime.js';

const MINUTE = 60_000;

function world({ child = false } = {}) {
  // A worker's own session only needs the header the runtime refuses on.
  const session = child
    ? { id: 'lesson-1', header: { origin: 'subagent' }, snapshotEvents: () => [] }
    : Session.create('lesson-1', [], { version: 4, id: 'lesson-1', createdAt: 0, isSeeded: false, agentPreset: 'notara-teacher' });
  const followups = [];
  const agent = { session, followup: message => followups.push(message) };
  const service = { agentFor: async () => agent, flush: async () => {} };
  const clock = { now: Date.UTC(2026, 8, 26, 10, 0) };
  const timers = [];
  const options = {
    now: () => clock.now,
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cleared = true; },
  };
  const live = () => timers.filter(timer => !timer.cleared);
  const fire = async () => { const [timer] = live(); timer.cleared = true; clock.now += timer.ms; await timer.fn(); await new Promise(resolve => setImmediate(resolve)); };
  const events = () => session.snapshotEvents().filter(event => event.type === POMODORO_EVENT).map(event => event.data);
  return { session, agent, service, clock, options, timers, live, fire, followups, events, runtime: createPomodoroRuntime(service, options) };
}

test('starting arms one Host timer for the whole phase and reports the Host clock', async () => {
  const { runtime, live, events } = world();
  const view = await runtime.start({ sessionId: 'lesson-1', phase: 'focus' });
  assert.equal(view.state, 'running');
  assert.equal(view.phase, 'focus');
  assert.equal(view.remainingMs, 25 * MINUTE);
  assert.equal(typeof view.now, 'string');
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, 25 * MINUTE);
  const [start] = events();
  assert.equal(start.op, 'start');
  assert.match(start.id, /^[0-9a-f-]{36}$/);
});

test('when the phase ends the teacher gets one hidden follow-up asking them to speak', async () => {
  const { runtime, fire, followups, events } = world();
  await runtime.start({ sessionId: 'lesson-1', phase: 'focus', minutes: 30 });
  await fire();
  assert.equal(followups.length, 1);
  const [message] = followups;
  assert.equal(message.role, 'user');
  // DSH 0.2.0 (session format v4) retired the `plugin` wrapper: a producer names its own source kind.
  assert.deepEqual({ kind: message.source.kind, form: message.source.form, plugin: message.source.plugin }, { kind: 'notara-pomodoro', form: 'notice', plugin: undefined });
  assert.match(message.content[0].text, /30 分钟/);
  assert.match(message.content[0].text, /主动开口/);
  assert.deepEqual(events().map(row => row.op), ['start', 'finish']);
  const view = await runtime.status({ sessionId: 'lesson-1' });
  assert.equal(view.state, 'idle');
  assert.equal(view.last.outcome, 'finished');
});

test('stopping clears the timer and nothing is delivered', async () => {
  const { runtime, live, followups, events } = world();
  await runtime.start({ sessionId: 'lesson-1', phase: 'focus' });
  const view = await runtime.stop({ sessionId: 'lesson-1' });
  assert.equal(view.state, 'idle');
  assert.equal(view.last.outcome, 'stopped');
  assert.equal(live().length, 0);
  assert.equal(followups.length, 0);
  assert.deepEqual(events().map(row => row.op), ['start', 'stop']);
  // Stopping again is harmless.
  assert.equal((await runtime.stop({ sessionId: 'lesson-1' })).state, 'idle');
});

test('a new start replaces the running timer instead of stacking a second one', async () => {
  const { runtime, live, fire, followups, events } = world();
  await runtime.start({ sessionId: 'lesson-1', phase: 'focus' });
  await runtime.start({ sessionId: 'lesson-1', phase: 'break' });
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, 5 * MINUTE);
  assert.deepEqual(events().map(row => row.op), ['start', 'stop', 'start']);
  await fire();
  assert.equal(followups.length, 1);
  assert.match(followups[0].content[0].text, /休息结束/);
});

test('after a restart the next status re-arms the remaining time', async () => {
  const first = world();
  await first.runtime.start({ sessionId: 'lesson-1', phase: 'focus' });
  first.runtime.dispose();
  assert.equal(first.live().length, 0);
  first.clock.now += 10 * MINUTE;
  const restarted = createPomodoroRuntime(first.service, first.options);
  const view = await restarted.status({ sessionId: 'lesson-1' });
  assert.equal(view.remainingMs, 15 * MINUTE);
  assert.equal(first.live().length, 1);
  assert.equal(first.live()[0].ms, 15 * MINUTE);
  await restarted.status({ sessionId: 'lesson-1' });
  assert.equal(first.live().length, 1, 'polling never stacks timers');
});

test('a phase that ended while nobody was here is delivered only if it is still fresh', async () => {
  const fresh = world();
  await fresh.runtime.start({ sessionId: 'lesson-1', phase: 'focus' });
  fresh.runtime.dispose();
  fresh.clock.now += 25 * MINUTE + 2 * MINUTE;
  const view = await createPomodoroRuntime(fresh.service, fresh.options).status({ sessionId: 'lesson-1' });
  assert.equal(view.state, 'idle');
  assert.equal(fresh.followups.length, 1);

  const stale = world();
  await stale.runtime.start({ sessionId: 'lesson-1', phase: 'focus' });
  stale.runtime.dispose();
  stale.clock.now += 25 * MINUTE + POMODORO_STALE_MS + MINUTE;
  const late = await createPomodoroRuntime(stale.service, stale.options).status({ sessionId: 'lesson-1' });
  assert.equal(late.state, 'idle');
  assert.equal(stale.followups.length, 0, 'a long-gone phase is closed without making the teacher speak');
  assert.equal(stale.events().at(-1).stale, true);
});

test('invalid lengths and worker sessions are refused before anything is written', async () => {
  const { runtime, events } = world();
  await assert.rejects(runtime.start({ sessionId: 'lesson-1', phase: 'focus', minutes: 500 }), /pomodoro_input_invalid/);
  assert.deepEqual(events(), []);
  const child = world({ child: true });
  await assert.rejects(child.runtime.start({ sessionId: 'lesson-1', phase: 'focus' }), /teaching_session_required/);
  assert.deepEqual(child.events(), []);
});
