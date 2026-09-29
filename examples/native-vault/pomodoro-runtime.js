import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { appendTeachingEvent } from './teaching-state.js';
import { POMODORO_EVENT, POMODORO_PHASES, foldPomodoro, pomodoroNotice, pomodoroView, validatePomodoroStart } from './pomodoro-data.js';

/** A phase that ended longer ago than this is closed without a follow-up. */
export const POMODORO_STALE_MS = 10 * 60_000;

const fail = code => { throw new Error(code); };
const ownEvents = session => session.snapshotEvents().filter(event => event.seq >= (session.inheritedEventCount ?? 0));

/**
 * The Host side of 番茄钟. Timers live only in this process; the session events
 * are the truth, so a restarted Host re-arms from them on the next status read.
 * When a phase ends the teacher gets one native follow-up (a plugin notice the
 * student does not see as their own message) asking them to speak first.
 */
export function createPomodoroRuntime(service, { now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = handle => clearTimeout(handle) } = {}) {
  const timers = new Map();
  const iso = ms => new Date(ms).toISOString();
  const state = session => foldPomodoro(ownEvents(session));

  async function teacher(sessionId) {
    const agent = await service.agentFor(sessionId);
    if (agent.session.header.origin === 'subagent') fail('teaching_session_required');
    return agent;
  }
  function disarm(sessionId) {
    const armed = timers.get(sessionId);
    if (armed) clearTimer(armed.handle);
    timers.delete(sessionId);
  }
  function arm(sessionId, current) {
    if (timers.get(sessionId)?.id === current.id) return;
    disarm(sessionId);
    const handle = setTimer(() => {
      timers.delete(sessionId);
      deliver(sessionId, current.id).catch(() => { /* the next status read retries */ });
    }, Math.max(0, Date.parse(current.endsAt) - now()));
    timers.set(sessionId, { id: current.id, handle });
  }
  /** Close the phase once and, while it is still fresh, wake the teacher. */
  async function deliver(sessionId, id) {
    const agent = await teacher(sessionId);
    // Fold, check and append without an await in between: a racing status read
    // and timer can never both close the same phase.
    const { current } = state(agent.session);
    if (current?.id !== id) return;
    const late = now() - Date.parse(current.endsAt);
    if (late < 0) { arm(sessionId, current); return; }
    const stale = late > POMODORO_STALE_MS;
    appendTeachingEvent(agent.session, POMODORO_EVENT, { op: 'finish', id, at: iso(now()), ...(stale ? { stale: true } : {}) });
    await service.flush(agent.session);
    if (stale) return;
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: pomodoroNotice(current) }],
      // Session format v4: a producer names its own source kind (the old `plugin` wrapper is refused).
      source: { kind: 'notara-pomodoro', form: 'notice', summary: `番茄钟：${POMODORO_PHASES[current.phase].label}结束` },
    }));
  }
  async function view(agent) {
    const { current } = state(agent.session);
    if (current && Date.parse(current.endsAt) <= now()) await deliver(agent.session.id, current.id);
    else if (current) arm(agent.session.id, current);
    return { ...pomodoroView(state(agent.session), now()), now: iso(now()) };
  }

  return {
    async status({ sessionId }) { return view(await teacher(sessionId)); },
    async start({ sessionId, phase, minutes }) {
      const request = validatePomodoroStart({ phase, minutes });
      const agent = await teacher(sessionId), { current } = state(agent.session);
      if (current) appendTeachingEvent(agent.session, POMODORO_EVENT, { op: 'stop', id: current.id, at: iso(now()) });
      disarm(sessionId);
      const startedAt = now();
      appendTeachingEvent(agent.session, POMODORO_EVENT, { op: 'start', id: randomUUID(), phase: request.phase, minutes: request.minutes, startedAt: iso(startedAt), endsAt: iso(startedAt + request.minutes * 60_000) });
      await service.flush(agent.session);
      return view(agent);
    },
    async stop({ sessionId }) {
      const agent = await teacher(sessionId), { current } = state(agent.session);
      disarm(sessionId);
      if (current) {
        appendTeachingEvent(agent.session, POMODORO_EVENT, { op: 'stop', id: current.id, at: iso(now()) });
        await service.flush(agent.session);
      }
      return view(agent);
    },
    dispose() {
      for (const { handle } of timers.values()) clearTimer(handle);
      timers.clear();
    },
  };
}
