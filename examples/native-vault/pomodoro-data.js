/**
 * 番茄钟: one timer per classroom, kept as `notara/pomodoro` session events so a
 * reopened or restarted classroom folds back to the same state. The Host owns
 * every id and timestamp; the page only asks to start or stop and shows the
 * remaining time the Host computed.
 */
import { pluginEventType } from './plugin-events.js';

export const POMODORO_EVENT = 'notara/pomodoro';

/** Phase lengths in whole minutes: default, then the accepted range. */
export const POMODORO_PHASES = Object.freeze({
  focus: Object.freeze({ label: '专注', minutes: 25, min: 5, max: 120 }),
  break: Object.freeze({ label: '休息', minutes: 5, min: 1, max: 30 }),
});

const fail = code => { throw new Error(code); };
const text = value => typeof value === 'string' && value.length > 0;

/** @returns the phase and minutes a start request may use. */
export function validatePomodoroStart(input) {
  const phase = POMODORO_PHASES[input?.phase];
  if (!phase) fail('pomodoro_input_invalid: phase 只接受 focus 或 break');
  const minutes = input.minutes ?? phase.minutes;
  if (!Number.isInteger(minutes) || minutes < phase.min || minutes > phase.max) fail(`pomodoro_input_invalid: ${input.phase} 需为 ${phase.min} 到 ${phase.max} 的整数分钟`);
  return { phase: input.phase, minutes };
}

const validStart = data => data?.op === 'start' && text(data.id) && Object.hasOwn(POMODORO_PHASES, data.phase)
  && Number.isInteger(data.minutes) && text(data.startedAt) && text(data.endsAt);

/**
 * Fold the session's own pomodoro events. The latest valid start is the running
 * timer until a stop or finish names that same id; a close for an older id is
 * stale and ignored.
 * @returns the running timer (or null) and the last closed one (or null).
 */
export function foldPomodoro(events) {
  let current = null, last = null;
  for (const event of events) {
    if (pluginEventType(event?.type) !== POMODORO_EVENT) continue;
    const data = event.data;
    if (validStart(data)) { current = data; continue; }
    if ((data?.op === 'stop' || data?.op === 'finish') && current && data.id === current.id) {
      last = { ...current, outcome: data.op === 'stop' ? 'stopped' : 'finished', at: data.at };
      current = null;
    }
  }
  return { current, last };
}

/** What the page shows, computed against the Host clock `now` (ms). */
export function pomodoroView({ current, last }, now) {
  const closed = last ? { phase: last.phase, minutes: last.minutes, outcome: last.outcome, at: last.at } : null;
  if (!current) return { state: 'idle', last: closed };
  return { state: 'running', phase: current.phase, minutes: current.minutes, endsAt: current.endsAt, remainingMs: Math.max(0, Date.parse(current.endsAt) - now), last: closed };
}

/**
 * The follow-up the teacher receives when a phase ends. It is a plugin notice,
 * not a student message: it asks the teacher to open the next turn in the
 * student-facing voice, and never names anything internal.
 */
export function pomodoroNotice({ phase, minutes }) {
  if (phase === 'break') {
    return `番茄钟：${minutes} 分钟的休息结束了。请主动开口，欢迎学生回来，用一句话接上刚才停在哪里，再给出接下来能动手的一小步。`;
  }
  return `番茄钟：学生开始的 ${minutes} 分钟专注时段刚刚结束。请主动开口：先就学生这段时间里的真实表现说一句具体的鼓励，不空夸；再提醒可以稍作休息 ${POMODORO_PHASES.break.minutes} 分钟。学生正在作答或正在思考时，只简短提一句，不打断这一步，也不借此总结整节课。`;
}
