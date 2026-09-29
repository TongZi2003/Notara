import assert from 'node:assert/strict';
import test from 'node:test';
import { POMODORO_CHOICES, choiceLabel, clockLabel, remainingAt } from './pomodoro-client.js';
import { POMODORO_PHASES, validatePomodoroStart } from './pomodoro-data.js';

test('the countdown rounds up so 0:00 only shows when the time is really up', () => {
  assert.equal(clockLabel(25 * 60_000), '25:00');
  assert.equal(clockLabel(61_001), '1:02');
  assert.equal(clockLabel(999), '0:01');
  assert.equal(clockLabel(0), '0:00');
  assert.equal(clockLabel(-5), '0:00');
});

test('remaining time comes from the Host figure and the page monotonic clock only', () => {
  const view = { state: 'running', remainingMs: 60_000 };
  assert.equal(remainingAt(view, 1000, 1000), 60_000);
  assert.equal(remainingAt(view, 1000, 31_000), 30_000);
  assert.equal(remainingAt(view, 1000, 999_999), 0);
  assert.equal(remainingAt({ state: 'idle' }, 0, 10), 0);
  assert.equal(remainingAt(null, 0, 10), 0);
});

test('every offered choice is one the Host accepts', () => {
  assert.ok(POMODORO_CHOICES.some(choice => choice.phase === 'focus' && choice.minutes === POMODORO_PHASES.focus.minutes));
  assert.ok(POMODORO_CHOICES.some(choice => choice.phase === 'break' && choice.minutes === POMODORO_PHASES.break.minutes));
  for (const choice of POMODORO_CHOICES) assert.deepEqual(validatePomodoroStart(choice), choice);
  assert.equal(choiceLabel({ phase: 'focus', minutes: 25 }), '专注 25 分钟');
  assert.equal(choiceLabel({ phase: 'break', minutes: 5 }), '休息 5 分钟');
});

test('a remote answer is unwrapped, and a refusal becomes the error the student reads', async () => {
  const { pomodoroValue } = await import('./pomodoro-client.js');
  assert.deepEqual(pomodoroValue({ ok: true, value: { state: 'idle', last: null } }), { state: 'idle', last: null });
  assert.throws(() => pomodoroValue({ ok: false, error: { message: '番茄钟时长不在可选范围内，请重新选择。' } }), /不在可选范围内/);
  assert.throws(() => pomodoroValue(undefined), /暂时不可用/);
});
