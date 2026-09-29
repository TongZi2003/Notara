import { BOARD_COMPONENTS, answersFor, staleAnswerSummary } from './board-components.js';

const letter = index => String.fromCharCode(65 + index);
const clock = at => { const date = new Date(at); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); };
const BLANK = /\{\{([^{}\n]*)\}\}/g;

/** Unsent drafts belong to this browser only; storage can be missing or refuse. */
function readDraft(key) { try { const raw = key && window.localStorage.getItem(key); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; } }
function writeDraft(key, value) { try { if (!key) return; if (value === undefined) window.localStorage.removeItem(key); else window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-viewer convenience only */ } }

/**
 * The practice side of the board: one view per answerable component. A draft
 * stays in this browser; 交给老师 stores the answer on the board and sends it
 * as the student's message (the Board does the call). Every question keeps two
 * exits — 不确定 and 都不对/我有别的想法 — so no option set traps the student.
 */
export function createBoardAnswers(React, { renderInline, inputs = {} }) {
  const h = React.createElement, { useState, useEffect } = React;
  const Inline = ({ text, className, as = 'span' }) => h(as, { className, dangerouslySetInnerHTML: { __html: renderInline(text) } });

  function initialDraft(component) {
    const { spec, type } = component;
    if (inputs[type]) return inputs[type].initial(component);
    if (type === 'choice') return { pick: [], reason: '', exit: null, note: '' };
    if (type === 'blank') return { fills: spec.blanks.map(() => ''), exit: null, note: '' };
    if (type === 'order') return spec.groups ? { assign: spec.items.map(() => -1), exit: null, note: '' } : { order: spec.items.map((_, index) => index), exit: null, note: '' };
    return { exit: null, note: '' };
  }
  /** The value sent to the Host, or a reason it is not ready yet. */
  function answerOf(component, draft) {
    const { spec, type } = component;
    if (draft.exit === 'unsure') return { value: { unsure: true, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) } };
    if (draft.exit === 'other') return draft.note.trim() ? { value: { other: draft.note.trim() } } : { missing: '写下你的想法再交。' };
    if (inputs[type]) return inputs[type].answer(component, draft);
    if (type === 'choice') {
      if (!draft.pick.length) return { missing: '先选一个选项。' };
      if (spec.reason === 'required' && !draft.reason.trim()) return { missing: '这道题要写一句理由。' };
      return { value: { pick: draft.pick, ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) } };
    }
    if (type === 'blank') return draft.fills.some(fill => fill.trim()) ? { value: { fills: draft.fills.map(fill => fill.trim()) } } : { missing: '至少填一个空。' };
    if (type === 'order') {
      if (!spec.groups) return { value: { order: draft.order } };
      if (draft.assign.some(group => group < 0)) return { missing: '每一条都放进一个组再交。' };
      return { value: { groups: spec.groups.map((_, group) => draft.assign.flatMap((value, item) => value === group ? [item] : [])) } };
    }
    return { missing: '这道题暂时不能作答。' };
  }

  function ChoiceInput({ component, draft, update, disabled }) {
    const { spec } = component;
    const toggle = index => update(previous => {
      const picked = previous.pick.includes(index);
      const pick = spec.multiple ? (picked ? previous.pick.filter(value => value !== index) : [...previous.pick, index].sort((a, b) => a - b)) : [index];
      return { ...previous, pick, exit: null };
    });
    return h(React.Fragment, null,
      h('div', { className: 'nb-q-options', role: spec.multiple ? 'group' : 'radiogroup', 'aria-label': spec.stem },
        spec.options.map((option, index) => h('button', { key: index, type: 'button', className: 'nb-q-option', role: spec.multiple ? 'checkbox' : 'radio', 'aria-checked': draft.pick.includes(index) && !draft.exit, disabled, onClick: () => toggle(index) },
          h('span', { className: 'nb-q-letter', 'aria-hidden': true }, letter(index)), h(Inline, { text: option })))),
      !draft.exit && h('textarea', { className: 'nb-q-note', rows: 2, disabled, value: draft.reason, placeholder: spec.reason === 'required' ? '写一句理由（这道题要写）' : '想说说为什么，也可以写在这里', 'aria-label': '理由', onChange: event => update(previous => ({ ...previous, reason: event.target.value })) }));
  }

  function BlankInput({ component, draft, update, disabled }) {
    const { spec } = component;
    let slot = -1;
    const fill = (index, value) => update(previous => ({ ...previous, fills: previous.fills.map((item, n) => n === index ? value : item), exit: null }));
    const line = (text, row) => {
      const parts = [];
      let end = 0;
      for (const match of text.matchAll(BLANK)) {
        if (match.index > end) parts.push(spec.code ? h('span', { key: `t${end}` }, text.slice(end, match.index)) : h(Inline, { key: `t${end}`, text: text.slice(end, match.index) }));
        const index = ++slot, hint = match[1].trim();
        parts.push(h('input', { key: `b${index}`, className: 'nb-q-blank', disabled, value: draft.fills[index] ?? '', placeholder: hint || '填在这里', 'aria-label': `第${index + 1}空${hint ? `：${hint}` : ''}`, size: Math.max(6, Math.min(40, (draft.fills[index] || hint || '').length + 2)), onChange: event => fill(index, event.target.value) }));
        end = match.index + match[0].length;
      }
      if (end < text.length) parts.push(spec.code ? h('span', { key: 'tail' }, text.slice(end)) : h(Inline, { key: 'tail', text: text.slice(end) }));
      return h('div', { key: row, className: 'nb-q-line' }, parts);
    };
    // A fill is previewed as a formula when it has $…$, or a LaTeX command written without dollars.
    const formula = value => value.includes('$') ? value : /\\[A-Za-z]+/.test(value) ? `$${value}$` : null;
    const preview = !spec.code && draft.fills.some(formula);
    return h(React.Fragment, null,
      h(spec.code ? 'pre' : 'div', { className: spec.code ? 'nb-q-code' : 'nb-q-lines', 'data-language': spec.code ?? undefined }, spec.lines.map(line)),
      preview && h('div', { className: 'nb-q-preview', 'aria-label': '公式预览' }, draft.fills.map((value, index) => formula(value) ? h('div', { key: index }, `第${index + 1}空：`, h(Inline, { text: formula(value) })) : null)));
  }

  function OrderInput({ component, draft, update, disabled }) {
    const { spec } = component;
    if (spec.groups) {
      const move = (item, group) => update(previous => ({ ...previous, assign: previous.assign.map((value, index) => index === item ? group : value), exit: null }));
      const chip = item => h('li', { key: item, className: 'nb-q-item', draggable: !disabled, onDragStart: event => event.dataTransfer.setData('text/plain', String(item)) },
        h(Inline, { text: spec.items[item] }),
        h('select', { 'aria-label': `把“${spec.items[item]}”放进`, disabled, value: String(draft.assign[item]), onChange: event => move(item, Number(event.target.value)) },
          h('option', { value: '-1' }, '待归类'), spec.groups.map((name, group) => h('option', { key: group, value: String(group) }, name))));
      const drop = group => ({ onDragOver: event => { if (!disabled) event.preventDefault(); }, onDrop: event => { event.preventDefault(); const item = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(item)) move(item, group); } });
      const pool = draft.assign.flatMap((group, item) => group < 0 ? [item] : []);
      return h('div', { className: 'nb-q-groups' },
        h('div', { className: 'nb-q-group', 'data-pool': true, ...drop(-1) }, h('strong', null, '待归类'), h('ul', null, pool.map(chip))),
        spec.groups.map((name, group) => h('div', { key: group, className: 'nb-q-group', ...drop(group) }, h('strong', null, name), h('ul', null, draft.assign.flatMap((value, item) => value === group ? [chip(item)] : [])))));
    }
    const shift = (position, delta) => update(previous => {
      const order = [...previous.order], target = position + delta;
      if (target < 0 || target >= order.length) return previous;
      [order[position], order[target]] = [order[target], order[position]];
      return { ...previous, order, exit: null };
    });
    return h('ol', { className: 'nb-q-order' }, draft.order.map((item, position) => h('li', { key: item, className: 'nb-q-item' },
      h(Inline, { text: spec.items[item] }),
      h('span', { className: 'nb-q-move' },
        h('button', { type: 'button', disabled: disabled || position === 0, 'aria-label': `上移“${spec.items[item]}”`, onClick: () => shift(position, -1) }, '↑'),
        h('button', { type: 'button', disabled: disabled || position === draft.order.length - 1, 'aria-label': `下移“${spec.items[item]}”`, onClick: () => shift(position, 1) }, '↓')))));
  }

  const INPUTS = { choice: ChoiceInput, blank: BlankInput, order: OrderInput };

  /** One answerable component: answering, then 已交 with its history. */
  function AnswerView({ component, answers, live, draftKey, slotKey, onSubmit, onResend }) {
    const { current, stale } = answersFor(component, answers);
    const latest = current.at(-1);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(() => readDraft(draftKey) ?? initialDraft(component));
    const [status, setStatus] = useState(null);
    useEffect(() => { setDraft(readDraft(draftKey) ?? initialDraft(component)); setEditing(false); setStatus(null); }, [draftKey]);
    const update = change => setDraft(previous => { const next = change(previous); writeDraft(draftKey, next); return next; });
    const answering = live && (!latest || editing);
    const ready = answerOf(component, draft);
    const exit = kind => update(previous => ({ ...previous, exit: previous.exit === kind ? null : kind }));
    async function submit() {
      if (ready.missing) { setStatus({ kind: 'error', text: ready.missing }); return; }
      setStatus({ kind: 'sending', text: '正在交给老师…' });
      try {
        const delivery = await onSubmit(ready.value);
        writeDraft(draftKey, undefined);
        setEditing(false);
        setStatus(delivery?.sent === false ? { kind: 'unsent', text: '已保存，但没能发给老师。', answerId: delivery.answerId }
          : { kind: 'done', text: delivery?.queued ? '已交，老师说完这段就会看到。' : '已交给老师。' });
      } catch (error) { setStatus({ kind: 'error', text: error.message }); }
    }
    async function resend() {
      setStatus({ kind: 'sending', text: '正在重新发送…' });
      try { const delivery = await onResend(status.answerId); setStatus(delivery?.sent === false ? { ...status, kind: 'unsent' } : { kind: 'done', text: delivery?.queued ? '已交，老师说完这段就会看到。' : '已交给老师。' }); }
      catch (error) { setStatus({ kind: 'unsent', text: error.message, answerId: status.answerId }); }
    }
    const Input = inputs[component.type]?.Input ?? INPUTS[component.type], otherLabel = component.type === 'choice' ? '都不对，我觉得……' : '我有别的想法……';
    const summary = entry => BOARD_COMPONENTS[component.type].text(component.spec, entry.v);
    return h('section', { className: 'nb-q', 'data-type': component.type, 'data-state': answering ? 'answering' : latest ? 'answered' : 'waiting', 'aria-label': BOARD_COMPONENTS[component.type].title },
      component.spec.stem && h(Inline, { as: 'div', className: 'nb-q-stem', text: component.spec.stem }),
      answering
        ? h(React.Fragment, null,
          h(Input, { component, draft, update, slotKey, disabled: status?.kind === 'sending' }),
          h('div', { className: 'nb-q-exits' },
            h('button', { type: 'button', 'aria-pressed': draft.exit === 'unsure', onClick: () => exit('unsure') }, '不确定'),
            h('button', { type: 'button', 'aria-pressed': draft.exit === 'other', onClick: () => exit('other') }, otherLabel)),
          draft.exit && h('textarea', { className: 'nb-q-note', rows: 2, value: draft.note, placeholder: draft.exit === 'other' ? '写下你的想法（必填）' : '哪里不确定？可以不写', 'aria-label': draft.exit === 'other' ? '我的想法' : '不确定的地方', onChange: event => update(previous => ({ ...previous, note: event.target.value })) }),
          h('div', { className: 'nb-q-actions' },
            h('button', { type: 'button', className: 'nb-q-submit', disabled: status?.kind === 'sending', onClick: submit }, '交给老师'),
            editing && h('button', { type: 'button', onClick: () => { setEditing(false); setStatus(null); } }, '取消'),
            status && h('span', { role: 'status', 'data-kind': status.kind }, status.text)))
        : latest
          ? h('div', { className: 'nb-q-done' },
            // A figure or diagram stays in view after answering, showing what was handed in.
            inputs[component.type]?.fromAnswer && h(Input, { component, draft: inputs[component.type].fromAnswer(component, latest.v, initialDraft(component)), update: () => {}, slotKey, disabled: true }),
            h('p', null, h('span', { className: 'nb-q-badge' }, '已交给老师'), ` ${clock(latest.at)} · `, h(Inline, { text: summary(latest) })),
            h('div', { className: 'nb-q-actions' },
              live && h('button', { type: 'button', onClick: () => { setEditing(true); setStatus(null); } }, '改答案'),
              // The badge already says 已交给老师; only a queue, a failed send or an error adds a line.
              status && (status.kind !== 'done' || status.text !== '已交给老师。') && h('span', { role: 'status', 'data-kind': status.kind }, status.text),
              status?.kind === 'unsent' && h('button', { type: 'button', onClick: resend }, '重新发送')))
          : h('p', { className: 'nb-q-wait' }, '老师写完这道题后就可以作答。'),
      current.length > 1 && h('details', { className: 'nb-q-history' }, h('summary', null, `之前的作答（${current.length - 1}）`),
        h('ul', null, current.slice(0, -1).map(entry => h('li', { key: entry.id }, `${clock(entry.at)} · `, h(Inline, { text: summary(entry) }))))),
      stale.length > 0 && h('details', { className: 'nb-q-history' }, h('summary', null, `题目修改前的作答（${stale.length}）`),
        h('ul', null, stale.map(entry => h('li', { key: entry.id }, `${clock(entry.at)} · `, h(Inline, { text: staleAnswerSummary(component.type, entry.v) }))))));
  }
  return AnswerView;
}
