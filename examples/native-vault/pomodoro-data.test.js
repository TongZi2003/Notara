import assert from 'node:assert/strict';
import test from 'node:test';
import { POMODORO_EVENT, POMODORO_PHASES, foldPomodoro, pomodoroNotice, pomodoroView, validatePomodoroStart } from './pomodoro-data.js';

const at = minutes => new Date(Date.UTC(2026, 8, 26, 10, minutes)).toISOString();
const event = data => ({ type: POMODORO_EVENT, data });

test('a focus and a break phase each have a default length and bounds', () => {
  assert.deepEqual(Object.keys(POMODORO_PHASES), ['focus', 'break']);
  assert.deepEqual(validatePomodoroStart({ phase: 'focus' }), { phase: 'focus', minutes: 25 });
  assert.deepEqual(validatePomodoroStart({ phase: 'break' }), { phase: 'break', minutes: 5 });
  assert.deepEqual(validatePomodoroStart({ phase: 'focus', minutes: 50 }), { phase: 'focus', minutes: 50 });
  for (const input of [{ phase: 'nap' }, { phase: 'focus', minutes: 4 }, { phase: 'focus', minutes: 121 }, { phase: 'break', minutes: 31 }, { phase: 'focus', minutes: 2.5 }, { phase: 'focus', minutes: '25' }]) {
    assert.throws(() => validatePomodoroStart(input), /pomodoro_input_invalid/, JSON.stringify(input));
  }
});

test('the latest start is the current timer until it is stopped or finished', () => {
  const start = { op: 'start', id: 'p1', phase: 'focus', minutes: 25, startedAt: at(0), endsAt: at(25) };
  assert.deepEqual(foldPomodoro([]), { current: null, last: null });
  assert.deepEqual(foldPomodoro([event(start)]).current, start);
  assert.deepEqual(foldPomodoro([event(start), event({ op: 'stop', id: 'p1', at: at(3) })]), { current: null, last: { ...start, outcome: 'stopped', at: at(3) } });
  assert.deepEqual(foldPomodoro([event(start), event({ op: 'finish', id: 'p1', at: at(25) })]).last.outcome, 'finished');
  // A stale stop for an older timer never closes the newer one.
  const next = { ...start, id: 'p2', startedAt: at(30), endsAt: at(55) };
  assert.equal(foldPomodoro([event(start), event(next), event({ op: 'stop', id: 'p1', at: at(31) })]).current.id, 'p2');
  // Other session events and malformed rows are ignored.
  assert.equal(foldPomodoro([{ type: 'user/message', data: {} }, event({ op: 'start', id: 'bad' }), event(start)]).current.id, 'p1');
});

test('the page gets the remaining time from the Host clock, never its own', () => {
  const start = { op: 'start', id: 'p1', phase: 'focus', minutes: 25, startedAt: at(0), endsAt: at(25) };
  const view = pomodoroView(foldPomodoro([event(start)]), Date.parse(at(10)));
  assert.deepEqual(view, { state: 'running', phase: 'focus', minutes: 25, endsAt: at(25), remainingMs: 15 * 60_000, last: null });
  assert.equal(pomodoroView(foldPomodoro([event(start)]), Date.parse(at(26))).remainingMs, 0);
  assert.deepEqual(pomodoroView(foldPomodoro([]), 0), { state: 'idle', last: null });
});

test('the notice asks the teacher to speak first, in the student-facing voice, without internals', () => {
  const focus = pomodoroNotice({ phase: 'focus', minutes: 25 });
  assert.match(focus, /25 分钟/);
  assert.match(focus, /主动开口/);
  assert.match(focus, /鼓励/);
  assert.match(focus, /休息/);
  assert.match(focus, /正在作答|正在思考/);
  const pause = pomodoroNotice({ phase: 'break', minutes: 5 });
  assert.match(pause, /休息/);
  assert.match(pause, /回来/);
  for (const text of [focus, pause]) assert.doesNotMatch(text, /notara|工具|tool|session|事件/i);
});
