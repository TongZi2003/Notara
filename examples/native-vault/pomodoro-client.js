import { createVaultClient } from './remote-client.js';
import { POMODORO_PHASES } from './pomodoro-data.js';

/** How often an open classroom re-reads the Host timer (also on window focus). */
export const POMODORO_POLL_MS = 15_000;

/** The lengths offered in the header; each is inside the Host's accepted range. */
export const POMODORO_CHOICES = Object.freeze([
  Object.freeze({ phase: 'focus', minutes: 25 }),
  Object.freeze({ phase: 'focus', minutes: 45 }),
  Object.freeze({ phase: 'break', minutes: 5 }),
  Object.freeze({ phase: 'break', minutes: 10 }),
]);

export const choiceLabel = ({ phase, minutes }) => `${POMODORO_PHASES[phase].label} ${minutes} 分钟`;

/** m:ss of what is left, rounded up so 0:00 only shows when time is really up. */
export function clockLabel(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Remaining time from the Host's own figure, advanced by the page's monotonic
 * clock since it arrived — never by the wall clock, which may disagree with the
 * Host's.
 */
export function remainingAt(view, receivedAt, now) {
  return view?.state === 'running' ? Math.max(0, view.remainingMs - (now - receivedAt)) : 0;
}

/** A remote call answers `{ok, value}`; only a value is state, a refusal is an error. */
export function pomodoroValue(result) {
  if (!result?.ok) throw new Error(result?.error?.message || '番茄钟暂时不可用，请稍后再试。');
  return result.value;
}

export const POMODORO_CSS = `
.nv-pomodoro-trigger{width:auto;min-width:30px;gap:5px;padding:0 7px;font-variant-numeric:tabular-nums;font-size:12px}
.nv-pomodoro[data-state=focus] .nv-pomodoro-trigger{color:var(--dsw-alias-label-primary)}
.nv-class-topbar[data-narrow=true] .nv-pomodoro-phase{display:none}
.nv-pomodoro-panel{min-width:210px;gap:2px}
.nv-pomodoro-panel p{margin:4px 8px 6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.nv-pomodoro-panel [role=alert]{color:var(--dsw-alias-state-danger-primary,#c0392b)}
`;

export function createPomodoroEntry(React, { Icon }) {
  const h = React.createElement, { useState, useEffect, useMemo, useRef, useCallback } = React;

  /** 番茄钟 in the classroom header: start a phase, see what is left, stop it. */
  function PomodoroEntry({ ctx, sessionId }) {
    const vault = useMemo(() => createVaultClient(ctx, sessionId), [ctx, sessionId]);
    const [clock, setClock] = useState({ view: null, receivedAt: 0 });
    const [now, setNow] = useState(() => performance.now());
    const [open, setOpen] = useState(false), [error, setError] = useState('');
    const root = useRef(null), busy = useRef(false), asked = useRef(''), generation = useRef(0);
    // Only the newest request may set the clock: a status read that was already
    // in flight when the student pressed start never rolls the view back.
    const accept = useCallback((ticket, view) => {
      if (ticket !== generation.current) return;
      const at = performance.now(); setClock({ view, receivedAt: at }); setNow(at);
    }, []);
    const refresh = useCallback(async () => {
      if (!sessionId) return;
      const ticket = ++generation.current;
      try { accept(ticket, pomodoroValue(await vault.pomodoro({ sessionId }))); } catch { /* keep the last reading */ }
    }, [vault, sessionId, accept]);
    useEffect(() => {
      setClock({ view: null, receivedAt: 0 });
      void refresh();
      const poll = setInterval(() => { if (!document.hidden) void refresh(); }, POMODORO_POLL_MS);
      const onFocus = () => { void refresh(); };
      window.addEventListener('focus', onFocus);
      return () => { clearInterval(poll); window.removeEventListener('focus', onFocus); };
    }, [refresh]);
    const { view } = clock, running = view?.state === 'running', left = remainingAt(view, clock.receivedAt, now);
    useEffect(() => {
      if (!running) return undefined;
      const tick = setInterval(() => setNow(performance.now()), 1000);
      return () => clearInterval(tick);
    }, [running]);
    // At zero ask the Host once: it closes the phase itself if its timer has not.
    useEffect(() => {
      if (running && left === 0 && asked.current !== view.endsAt) { asked.current = view.endsAt; void refresh(); }
    }, [running, left, view, refresh]);
    useEffect(() => {
      if (!open) return undefined;
      const dismiss = event => { if (!root.current?.contains(event.target)) setOpen(false); };
      const key = event => { if (event.key === 'Escape') setOpen(false); };
      window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key);
      return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); };
    }, [open]);
    const act = async run => {
      if (busy.current) return;
      busy.current = true;
      const ticket = ++generation.current;
      try { accept(ticket, pomodoroValue(await run())); setError(''); setOpen(false); }
      catch (failure) { setError(failure?.message || '番茄钟暂时不可用，请稍后再试。'); }
      finally { busy.current = false; }
    };
    const phase = running ? POMODORO_PHASES[view.phase].label : '';
    const label = running ? `番茄钟：${phase}还剩 ${clockLabel(left)}` : '番茄钟';
    return h('div', { className: 'nv-popover nv-pomodoro', ref: root, 'data-state': running ? view.phase : 'idle' }, h('style', null, POMODORO_CSS),
      h('button', { type: 'button', className: 'nv-icon nv-pomodoro-trigger', disabled: !sessionId, title: label, 'aria-label': label, 'aria-haspopup': 'true', 'aria-expanded': open, onClick: () => setOpen(value => !value) },
        h(Icon, { name: 'timer' }),
        running && h('span', { 'aria-hidden': true }, h('span', { className: 'nv-pomodoro-phase' }, `${phase} `), clockLabel(left))),
      open && h('div', { className: 'nv-popover-panel nv-pomodoro-panel', role: 'group', 'aria-label': '番茄钟' },
        running
          ? [h('p', { key: 'note' }, `${phase}中，到点后老师会主动提醒你。`),
            h('button', { key: 'stop', type: 'button', onClick: () => { void act(() => vault.stopPomodoro({ sessionId })); } }, `结束这段${phase}`)]
          : [h('p', { key: 'note' }, '到点后老师会主动开口：专注结束时鼓励你、提醒休息，休息结束时带你回来。'),
            ...POMODORO_CHOICES.map(choice => h('button', { key: `${choice.phase}-${choice.minutes}`, type: 'button', onClick: () => { void act(() => vault.startPomodoro({ sessionId, phase: choice.phase, minutes: choice.minutes })); } }, `开始${choiceLabel(choice)}`))],
        error && h('p', { role: 'alert' }, error)));
  }

  return { PomodoroEntry };
}
