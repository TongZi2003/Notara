import { answersFor } from './board-components.js';

/**
 * 逐帧演示 on the board: step through frames; a covered frame opens only after
 * the student hands in a prediction (sent to the teacher as their message) or
 * chooses 直接看 (recorded, not sent). A revealed frame shows the student's own
 * prediction beside it, so the comparison is theirs to make.
 */
export function createBoardFrames(React, { renderMarkdown }) {
  const h = React.createElement, { useState, useEffect, useRef } = React;
  return function FramesView({ component, block, live, onSubmit }) {
    const { spec } = component, total = spec.frames.length;
    const { current } = answersFor(component, block.answers);
    const byFrame = new Map(current.map(entry => [entry.v.frame, entry]));
    const [position, setPosition] = useState({fingerprint:component.fingerprint,index:0}), [draft, setDraft] = useState(''), [status, setStatus] = useState(null);
    const index=position.fingerprint===component.fingerprint?Math.min(position.index,total-1):0;
    const request=useRef(0),fingerprint=useRef(component.fingerprint);
    fingerprint.current=component.fingerprint;
    const navigate=index=>{request.current++;setPosition({fingerprint:component.fingerprint,index});setStatus(null);};
    useEffect(() => { setPosition({fingerprint:component.fingerprint,index:0}); setDraft(''); setStatus(null); return()=>{request.current++;}; }, [component.fingerprint]);
    const covered = frame => spec.frames[frame]?.predict && !byFrame.has(frame);
    const frame = spec.frames[index], next = index + 1, nextCovered = next < total && covered(next);
    const mine = byFrame.get(index)?.v;
    async function hand(value, reveal) {
      const serial=++request.current,identity=component.fingerprint;
      setStatus({ kind: 'sending', text: value.skipped ? '正在打开下一帧…' : '正在交给老师…' });
      try {
        const delivery = await onSubmit(value);
        if(serial!==request.current||identity!==fingerprint.current)return;
        setDraft(''); setPosition({fingerprint:identity,index:reveal});
        setStatus(value.skipped ? null : delivery?.sent === false ? { kind: 'unsent', text: '预测已保存，但没能发给老师。' } : { kind: 'done', text: delivery?.queued ? '已交，老师说完这段就会看到。' : '预测已交给老师。' });
      } catch (error) { if(serial===request.current&&identity===fingerprint.current)setStatus({ kind: 'error', text: error.message }); }
    }
    const submit = () => { if (!draft.trim()) { setStatus({ kind: 'error', text: '先写下你的预测。' }); return; } hand({ frame: next, text: draft.trim() }, next); };
    return h('section', { className: 'nb-frames', 'aria-label': spec.title ?? '逐帧演示' },
      spec.title && h('div', { className: 'nb-frames-title' }, spec.title),
      h('div', { className: 'nb-frames-stage', 'aria-live': 'polite' },
        h('div', { className: 'nb-frames-caption' }, `第 ${index + 1}/${total} 帧${frame.caption ? ` · ${frame.caption}` : ''}`),
        h('div', { className: 'nb-md', dangerouslySetInnerHTML: { __html: renderMarkdown(frame.body) } }),
        mine && h('p', { className: 'nb-frames-mine' }, mine.skipped ? '这一帧你没有预测，直接看了。' : mine.unsure ? '这一帧你没有预测出来。' : `你的预测：${mine.text}`)),
      h('div', { className: 'nb-frames-nav' },
        h('button', { type: 'button', disabled: index === 0, onClick: () => navigate(index - 1) }, '上一帧'),
        h('span', { className: 'nb-frames-dots', 'aria-hidden': true }, spec.frames.map((item, n) => h('i', { key: n, 'data-current': n === index ? 'true' : undefined, 'data-covered': covered(n) ? 'true' : undefined }))),
        h('button', { type: 'button', disabled: next >= total || nextCovered, onClick: () => navigate(next) }, '下一帧')),
      nextCovered && (live
        ? h('div', { className: 'nb-frames-predict' },
          h('label', null, `先想一想：第 ${next + 1} 帧${spec.frames[next].caption ? `（${spec.frames[next].caption}）` : ''}会是什么样？`,
            h('textarea', { className: 'nb-q-note', rows: 2, value: draft, disabled: status?.kind === 'sending', placeholder: '写下你的预测，交给老师后揭开这一帧', onChange: event => setDraft(event.target.value) })),
          h('div', { className: 'nb-q-actions' },
            h('button', { type: 'button', className: 'nb-q-submit', disabled: status?.kind === 'sending', onClick: submit }, '交给老师'),
            h('button', { type: 'button', disabled: status?.kind === 'sending', onClick: () => hand({ frame: next, skipped: true }, next) }, '直接看'),
            status && h('span', { role: 'status', 'data-kind': status.kind }, status.text)))
        : h('p', { className: 'nb-q-wait' }, '老师写完后就可以预测下一帧。')),
      !nextCovered && status && h('div', { className: 'nb-q-actions' }, h('span', { role: 'status', 'data-kind': status.kind }, status.text)));
  };
}
