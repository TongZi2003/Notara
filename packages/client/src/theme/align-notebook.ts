/** B's measured paper rhythm, applied to native paragraphs without editing text. */
export function alignNotebook(): () => void {
  const changed = new Map<HTMLElement, Map<string, string>>();
  const observed = new Set<Element>();
  const metrics = new Map<string, number>();
  let frame: number | undefined;
  let closed = false;
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
      if (document.body.dataset.sfNotebook !== 'on') return;
      const row = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--nb-row')) || 32;
      const grid = document.body.dataset.sfPaper === 'fangge';
      const blocks = document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="assistant-step"] p,[data-chat-flow-kind="assistant-step"] li:not(:has(p,li))');
      for (const element of blocks) {
        if (!element.getClientRects().length) continue;
        set(element, '--sf-ink-shift', (grid ? 0 : row - 4 - baseline(element)).toFixed(2) + 'px');
      }
      for (const element of document.querySelectorAll<HTMLElement>('[data-chat-flow]>[data-chat-flow-kind]')) {
        const padding = Number.parseFloat(element.style.getPropertyValue('--sf-row-pad')) || 0;
        const height = element.getBoundingClientRect().height - padding;
        if (height) set(element, '--sf-row-pad', gap(height, row).toFixed(2) + 'px');
      }
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
  appearance.observe(document.body, { attributes: true, attributeFilter: ['data-sf-notebook', 'data-sf-paper', 'data-sf-size', 'data-sf-scheme'] });
  const fonts = (): void => { metrics.clear(); schedule(); };
  document.fonts.addEventListener('loadingdone', fonts); schedule();
  return () => {
    closed = true; if (frame !== undefined) cancelAnimationFrame(frame);
    resize.disconnect(); content.disconnect(); appearance.disconnect(); document.fonts.removeEventListener('loadingdone', fonts);
    for (const [element, prior] of changed) for (const [key, value] of prior) {
      if (value) element.style.setProperty(key, value); else element.style.removeProperty(key);
    }
  };
}
