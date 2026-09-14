/** B's measured paper rhythm, applied to native paragraphs without editing text. */
export function alignNotebook(): () => void {
  const changed = new Map<HTMLElement, Map<string, string>>();
  const observed = new Set<Element>();
  const metrics = new Map<string, number>();
  let frame: number | undefined;
  let closed = false;
  const restore = (): void => {
    for (const [element, prior] of changed) for (const [key, value] of prior) {
      if (value) element.style.setProperty(key, value); else element.style.removeProperty(key);
    }
    changed.clear();
  };
  const selector = '[data-chat-flow-kind="assistant-step"] :is(p,li:not(:has(p,li)),h1,h2,h3,h4,h5,h6),.sf-tool-step summary,'
    + ':is([data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]) [data-slot="conversation.chat.node"]>div>div:first-child>div:not([data-message-attachments])';
  const set = (element: HTMLElement, key: string, value: string): void => {
    let prior = changed.get(element);
    if (!prior) { prior = new Map(); changed.set(element, prior); }
    if (!prior.has(key)) prior.set(key, element.style.getPropertyValue(key));
    if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value);
  };
  const gap = (height: number, row: number): number => {
    const rest = ((height % row) + row) % row;
    return rest < .1 || row - rest < .1 ? 0 : row - rest;
  };
  const baseline = (element: HTMLElement): number => {
    const css = getComputedStyle(element);
    const key = [css.fontFamily, css.fontSize, css.fontWeight, css.fontStyle, css.lineHeight].join('|');
    const saved = metrics.get(key); if (saved !== undefined) return saved;
    const sample = document.createElement('span'), marker = document.createElement('i');
    sample.ariaHidden = 'true'; sample.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:nowrap;padding:0;margin:0;border:0';
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight'] as const) sample.style[property] = css[property];
    marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0';
    sample.append('国Ag', marker); document.body.append(sample);
    const result = marker.getBoundingClientRect().top - sample.getBoundingClientRect().top;
    sample.remove(); metrics.set(key, result); return result;
  };
  const schedule = (): void => {
    if (frame !== undefined || closed) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (document.body.dataset.sfNotebook !== 'on' || document.body.dataset.sfStyle === 'modern') { restore(); return; }
      const row = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--nb-row')) || 32;
      const grid = document.body.dataset.sfPaper === 'fangge';
      for (const flow of document.querySelectorAll<HTMLElement>('[data-chat-flow]')) {
        const paper = flow.closest<HTMLElement>('[data-sf-conversation-paper]');
        if (!paper) continue;
        const origin = flow.getBoundingClientRect().top;
        // The whole sheet moves with the written content, including during a
        // native scroll. A stationary viewport texture cannot align moving ink.
        set(paper, '--sf-paper-scroll-offset', `${origin - paper.getBoundingClientRect().top}px`);
        for (const element of flow.querySelectorAll<HTMLElement>(selector)) {
          if (!element.getClientRects().length || element.closest('.sf-proposal-slip,.sf-tool-details,table,pre')) continue;
          const current = Number.parseFloat(element.style.getPropertyValue('--sf-ink-shift')) || 0;
          const natural = element.getBoundingClientRect().top - current;
          const paddingTop = Number.parseFloat(getComputedStyle(element).paddingTop) || 0;
          const shift = grid ? 0 : gap(natural + paddingTop + baseline(element) - origin + 4, row);
          set(element, '--sf-ink-shift', shift.toFixed(2) + 'px');
        }
        for (const wrapper of flow.querySelectorAll<HTMLElement>('div:has(>table)')) {
          if (!wrapper.getClientRects().length || wrapper.closest('.sf-proposal-slip,.sf-tool-details')) continue;
          const cell = wrapper.querySelector<HTMLElement>('th,td');
          if (!cell) continue;
          const css = getComputedStyle(cell);
          const current = Number.parseFloat(wrapper.style.getPropertyValue('--sf-ink-shift')) || 0;
          const firstBaseline = cell.getBoundingClientRect().top - current + Number.parseFloat(css.paddingTop)
            + Number.parseFloat(css.borderTopWidth) + baseline(cell);
          set(wrapper, '--sf-ink-shift', (grid ? 0 : gap(firstBaseline - origin + 4, row)).toFixed(2) + 'px');
        }
        for (const element of flow.querySelectorAll<HTMLElement>(':scope>[data-chat-flow-kind]')) {
          const padding = Number.parseFloat(element.style.getPropertyValue('--sf-row-pad')) || 0;
          const rect = element.getBoundingClientRect();
          let height = rect.height - padding;
          for (const text of element.querySelectorAll<HTMLElement>(selector + ',div:has(>table)')) {
            if (text.getClientRects().length) height = Math.max(height, text.getBoundingClientRect().bottom - rect.top);
          }
          if (height) set(element, '--sf-row-pad', (height + gap(height, row) - (rect.height - padding)).toFixed(2) + 'px');
        }
      }
      for (const input of document.querySelectorAll<HTMLElement>('[data-composer-input]'))
        set(input, '--sf-input-pad', (grid ? 0 : gap(baseline(input) + 4, row)).toFixed(2) + 'px');
      for (const element of observed) if (!element.isConnected) { resize.unobserve(element); observed.delete(element); }
      for (const element of changed.keys()) if (!element.isConnected) changed.delete(element);
      for (const element of document.querySelectorAll('[data-chat-flow],[data-chat-flow-kind]')) if (!observed.has(element)) { observed.add(element); resize.observe(element); }
    });
  };
  const resize = new ResizeObserver(schedule);
  const content = new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && record.target.closest('[data-chat-flow]')
      || [...record.addedNodes].some(node => node instanceof Element && (node.matches('[data-chat-flow]') || node.querySelector('[data-chat-flow]'))))) schedule();
  });
  content.observe(document.body, { childList: true, subtree: true, characterData: true });
  const appearance = new MutationObserver(schedule);
  appearance.observe(document.body, { attributes: true, attributeFilter: ['data-sf-notebook', 'data-sf-style', 'data-sf-paper', 'data-sf-size', 'data-sf-scheme', 'data-sf-table'] });
  const fonts = (): void => { metrics.clear(); schedule(); };
  const scroll = (): void => {
    if (document.body.dataset.sfNotebook !== 'on' || document.body.dataset.sfStyle === 'modern') return;
    for (const flow of document.querySelectorAll<HTMLElement>('[data-chat-flow]')) {
      const paper = flow.closest<HTMLElement>('[data-sf-conversation-paper]');
      if (paper) set(paper, '--sf-paper-scroll-offset', `${flow.getBoundingClientRect().top - paper.getBoundingClientRect().top}px`);
    }
  };
  document.addEventListener('scroll', scroll, { capture: true, passive: true });
  document.fonts.addEventListener('loadingdone', fonts); schedule();
  return () => {
    closed = true; if (frame !== undefined) cancelAnimationFrame(frame);
    resize.disconnect(); content.disconnect(); appearance.disconnect(); document.fonts.removeEventListener('loadingdone', fonts);
    document.removeEventListener('scroll', scroll, true);
    restore();
  };
}
