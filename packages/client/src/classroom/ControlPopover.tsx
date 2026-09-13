import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A control menu escapes clipped panes but remains within the viewport. The
 * anchor stays local; scrolling/resizing repositions it, Escape restores focus. */
export function ControlPopover({ label, title, className = '', testId, children }: {
  label: ReactNode; title: string; className?: string; testId?: string; children: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const anchor = trigger.current?.getBoundingClientRect(), box = menu.current; if (!anchor || !box) return;
      const margin = 10, width = Math.min(280, window.innerWidth - margin * 2), above = anchor.top - margin - 7, below = window.innerHeight - anchor.bottom - margin - 7;
      const upwards = above >= Math.min(260, below), height = Math.min(360, upwards ? above : below);
      setPosition({ left: Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin)), top: upwards ? Math.max(margin, anchor.top - Math.min(box.scrollHeight, height) - 7) : anchor.bottom + 7, maxHeight: Math.max(100, height) });
    };
    place(); const observer = new ResizeObserver(place); if (menu.current) observer.observe(menu.current);
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => { const target = event.target as Node; if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false); };
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className={'sf-control-popover ' + className} data-testid={testId}>
    <button type="button" className="sf-control-trigger" title={title} aria-label={title} aria-haspopup="dialog" aria-expanded={open} ref={trigger} onClick={() => setOpen(!open)}>{label}<span aria-hidden="true">⌄</span></button>
    {open && createPortal(<div className="sf-control-menu" role="dialog" aria-label={title} ref={menu} style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}>{children}</div>, document.body)}
  </div>;
}
