export const PRODUCT_NAME = 'Notara · 拾页';
export const PRODUCT_MARK = '拾';

/** DSH 0.1.5 has no product-title setting. Preserve its session-title projection. */
export function mountProductTitle(): () => void {
  const nativeName = 'DeepSeek Harness';
  const suffix = ` — ${nativeName}`;
  const title = document.head.querySelector('title') ?? document.head.appendChild(document.createElement('title'));
  let nativeTitle = document.title;
  let projectedTitle: string | undefined;
  const update = (): void => {
    const current = document.title;
    if (current === projectedTitle) return;
    if (current !== '' && current !== nativeName && !current.endsWith(suffix)) return;
    nativeTitle = current;
    projectedTitle = current.endsWith(suffix) ? `${current.slice(0, -suffix.length)} — ${PRODUCT_NAME}` : PRODUCT_NAME;
    document.title = projectedTitle;
  };
  const observer = new MutationObserver(update);
  observer.observe(title, { childList: true, characterData: true, subtree: true });
  update();
  return () => {
    observer.disconnect();
    if (document.title === projectedTitle) document.title = nativeTitle;
  };
}
