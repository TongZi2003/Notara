import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialVersion } from '@studyforge/contracts/material-records';
import type { SourceAnchor, SourceLocator } from '@studyforge/contracts/materials';
import type { DocxIndex } from '@studyforge/domain/docx';
import type { SourceReferences } from './source-selection.ts';
import { MaterialPreview } from './MaterialPreview.tsx';
import { cardOpenRequest } from '../cards/CardOpenRequest.tsx';
import { captureAnchors } from './anchors/index.ts';
import { pdfGeometryOf, pdfLocatorRects } from './anchors/pdf.ts';
import { applyTransform, clampUnit } from './anchors/geometry.ts';
import { decodeText } from './files.ts';

interface Props {
  ctx: Context;
  version: MaterialVersion; data: Uint8Array; index: DocxIndex | undefined;
  references: SourceReferences; sessionId: string | undefined; locator?: SourceLocator | undefined;
  onPage?: ((page: number) => void) | undefined;
}
/** Shared library/native document body; capture always belongs to its exact bytes. */
export function SourceCapture({ ctx, version, data, index, references, sessionId, locator, onPage }: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; target: HTMLCanvasElement | HTMLImageElement }>();
  const [sourceView, setSourceView] = useState(locator?.kind === 'text');
  const [notice, setNotice] = useState('');
  const [boxes, setBoxes] = useState<readonly { left: number; top: number; width: number; height: number }[]>([]);
  const [pending, setPending] = useState<readonly SourceAnchor[] | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [cards, setCards] = useState<readonly CardView[]>([]);
  const [cardTick, setCardTick] = useState(0);
  const [annotations, setAnnotations] = useState<readonly { ref: string; title: string; left: number; top: number; width: number; height: number }[]>([]);
  const pageRef = useRef<number>();
  const text = version.mediaType.startsWith('text/') ? decodeText(data) : undefined;
  useEffect(() => { if (locator?.kind === 'text') setSourceView(true); }, [locator]);
  function stage(anchors: readonly SourceAnchor[], quote: string): void {
    if (anchors.length === 0) return;
    setPending(anchors);
    // Saving an annotation card needs no lesson; the conversation pick does.
    if (sessionId === undefined) { setNotice('已选好；可存为标注卡，开始一节课后也能引用它。'); return; }
    references.stage(sessionId, version.title + ' · 选段', { selection: { text: quote, sources: [...anchors] } });
    setNotice('已选好；下一条消息会附带这处，可在输入框移除。');
  }
  /** The staged anchors also make a persistent source-only card — a MarginNote-style excerpt. */
  async function saveAnnotation(): Promise<void> {
    const anchors = pending;
    if (anchors === undefined || anchors.length === 0 || saving) return;
    setSaving(true);
    const page = anchors[0]?.locator.kind === 'pdf' ? anchors[0].locator.page : undefined;
    const result = await ctx.remote.studyforgeLearning.createCard({
      operationId: crypto.randomUUID(),
      content: { title: version.title + (page === undefined ? ' · 标注' : ` · 第${String(page)}页`),
        presentation: 'note', front: '', sections: [], notes: '', sources: [...anchors], tags: [], links: [] },
    });
    setSaving(false);
    if (!result.ok) { setNotice('标注没有存下来：' + (result.error?.message ?? '稍后再试一次。')); return; }
    setPending(undefined);
    setNotice('已存为标注卡；在卡库里可以继续整理它。');
    setCardTick(tick => tick + 1);
  }
  useEffect(() => {
    const onSelection = (): void => {
      const container = content.current, selection = window.getSelection();
      if (container === null || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
      const anchors = captureAnchors({
        root: container, source: text, materialId: version.materialId, versionId: version.versionId, mediaType: version.mediaType,
      }, range);
      if (anchors.length) stage(anchors, selection.toString());
      else setNotice('这段排版暂时无法准确定位，请切换“按原文选取”。');
    };
    document.addEventListener('selectionchange', onSelection);
    return () => { document.removeEventListener('selectionchange', onSelection); };
  }, [version, text, sessionId, references]);
  function begin(event: PointerEvent<HTMLDivElement>): void {
    if (!(event.target instanceof HTMLCanvasElement || event.target instanceof HTMLImageElement)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, target: event.target };
  }
  function finish(event: PointerEvent<HTMLDivElement>): void {
    event.stopPropagation();
    const start = drag.current; drag.current = undefined;
    if (start === undefined) return;
    const area = { left: Math.min(start.x, event.clientX), top: Math.min(start.y, event.clientY), right: Math.max(start.x, event.clientX), bottom: Math.max(start.y, event.clientY) };
    if (area.right - area.left < 2 || area.bottom - area.top < 2) return;
    let selected: SourceLocator | undefined;
    if (start.target instanceof HTMLCanvasElement) selected = pdfLocatorRects(start.target, start.target, [area]);
    else {
      const box = start.target.getBoundingClientRect();
      const rect = clampUnit([(area.left - box.left) / box.width, (area.top - box.top) / box.height, (area.right - box.left) / box.width, (area.bottom - box.top) / box.height]);
      if (rect) selected = { kind: 'image', rect: [...rect] };
    }
    if (selected) {
      stage([{ materialId: version.materialId, versionId: version.versionId, locator: selected }], '');
      const origin = root.current?.getBoundingClientRect();
      if (origin) setBoxes([{ left: area.left - origin.left, top: area.top - origin.top, width: area.right - area.left, height: area.bottom - area.top }]);
    }
  }
  // The annotation layer reads the real card inventory; saving one bumps cardTick.
  useEffect(() => {
    let live = true;
    void ctx.remote.studyforgeLearning.cards().then(result => {
      if (live && result.ok) setCards(result.value);
    }).catch(() => { /* The library page owns the actionable failure. */ });
    return () => { live = false; };
  }, [ctx, cardTick]);
  // Stored rect anchors → screen boxes, on the page really on canvas right now.
  useEffect(() => {
    const container = content.current, outer = root.current;
    if (!container || !outer) return;
    let frame = 0;
    const reveal = (): void => {
      const origin = outer.getBoundingClientRect();
      const next: { ref: string; title: string; left: number; top: number; width: number; height: number }[] = [];
      const push = (card: CardView, rect: readonly number[], box: DOMRect): void => {
        next.push({ ref: card.ref, title: card.content.title,
          left: box.left + rect[0]! * box.width - origin.left, top: box.top + rect[1]! * box.height - origin.top,
          width: (rect[2]! - rect[0]!) * box.width, height: (rect[3]! - rect[1]!) * box.height });
      };
      const canvas = container.querySelector('canvas');
      const geometry = canvas instanceof HTMLCanvasElement ? pdfGeometryOf(canvas) : undefined;
      for (const card of cards) {
        for (const source of card.content.sources) {
          if (source.materialId !== version.materialId || source.versionId !== version.versionId) continue;
          const loc = source.locator;
          if (loc.kind === 'pdf' && loc.rect !== undefined && geometry !== undefined && geometry.page === loc.page && canvas !== null) {
            const [x0, y0, x1, y1] = geometry.view;
            const a = applyTransform(geometry.transform, x0 + loc.rect[0]! * (x1 - x0), y1 - loc.rect[1]! * (y1 - y0));
            const b = applyTransform(geometry.transform, x0 + loc.rect[2]! * (x1 - x0), y1 - loc.rect[3]! * (y1 - y0));
            push(card, [Math.min(a[0], b[0]) / geometry.baseWidth, Math.min(a[1], b[1]) / geometry.baseHeight,
              Math.max(a[0], b[0]) / geometry.baseWidth, Math.max(a[1], b[1]) / geometry.baseHeight], canvas.getBoundingClientRect());
          } else if (loc.kind === 'image' && loc.rect !== undefined) {
            const img = container.querySelector('img');
            if (img !== null) push(card, loc.rect, img.getBoundingClientRect());
          }
        }
      }
      setAnnotations(next);
    };
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); };
    const observer = new MutationObserver(schedule);
    observer.observe(container, { subtree: true, childList: true, attributes: true });
    const resize = new ResizeObserver(schedule); resize.observe(container);
    container.addEventListener('load', schedule, true);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); container.removeEventListener('load', schedule, true); };
  }, [cards, version, data]);
  useEffect(() => {
    const container = content.current, outer = root.current;
    if (!container || !outer || !locator) return;
    let frame = 0;
    const reveal = (): void => {
      const origin = outer.getBoundingClientRect();
      const relative = (box: { left: number; top: number; width: number; height: number }) => ({ width: box.width, height: box.height, left: box.left - origin.left, top: box.top - origin.top });
      if (locator.kind === 'pdf' || locator.kind === 'image') {
        const target = container.querySelector(locator.kind === 'pdf' ? 'canvas' : 'img');
        if (!(target instanceof HTMLElement)) return;
        const box = target.getBoundingClientRect();
        let rect: readonly number[] | undefined = locator.rect;
        if (locator.kind === 'pdf') {
          const geometry = pdfGeometryOf(target);
          if (!geometry || geometry.page !== locator.page) return;
          if (rect) {
            const [x0,y0,x1,y1] = geometry.view;
            const a = applyTransform(geometry.transform, x0 + rect[0]! * (x1-x0), y1 - rect[1]! * (y1-y0));
            const b = applyTransform(geometry.transform, x0 + rect[2]! * (x1-x0), y1 - rect[3]! * (y1-y0));
            rect = [Math.min(a[0],b[0])/geometry.baseWidth, Math.min(a[1],b[1])/geometry.baseHeight, Math.max(a[0],b[0])/geometry.baseWidth, Math.max(a[1],b[1])/geometry.baseHeight];
          }
        }
        if (rect) setBoxes([relative({ left: box.left + rect[0]! * box.width, top: box.top + rect[1]! * box.height, width: (rect[2]! - rect[0]!) * box.width, height: (rect[3]! - rect[1]!) * box.height })]);
        return;
      }
      const block = locator.kind === 'docx'
        ? [...container.querySelectorAll<HTMLElement>('[data-sf-block-id]')].find(element => element.dataset.sfBlockId === locator.blockId && (element.dataset.sfPart ?? 'word/document.xml') === locator.part)
        : container.querySelector<HTMLElement>('[data-source-text]');
      if (!block) return;
      const value = block.textContent ?? '';
      const offset = (point: { line: number; column: number }): number => value.split('\n').slice(0, point.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + point.column;
      const start = locator.kind === 'docx' ? locator.start : offset(locator.start);
      const end = locator.kind === 'docx' ? locator.end : offset(locator.end);
      const range = rangeAt(block, start, end);
      if (!range) return;
      setBoxes([...range.getClientRects()].map(relative));
    };
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); };
    const observer = new MutationObserver(schedule);
    observer.observe(container, { subtree: true, childList: true, attributes: true });
    const resize = new ResizeObserver(schedule); resize.observe(container);
    container.addEventListener('load', schedule, true);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); container.removeEventListener('load', schedule, true); };
  }, [locator, sourceView, data, index]);
  return <div ref={root} style={{ position: 'relative' }} data-testid="source-capture">
    {version.mediaType === 'text/markdown' && <button type="button" onClick={() => { setSourceView(value => !value); }}>{sourceView ? '阅读排版' : '按原文选取'}</button>}
    {notice && <p role="status">{notice}</p>}
    <div ref={content} onPointerDown={begin} onPointerUp={finish} onPointerCancel={() => { drag.current = undefined; }}>
      {sourceView && text !== undefined ? <pre data-source-text="true" data-testid="source-text">{text}</pre>
        : <MaterialPreview version={version} data={data} index={index} locator={locator} onPage={page => {
          if (pageRef.current !== undefined && pageRef.current !== page) {
            if (sessionId) references.clearSelection(sessionId, version.materialId, version.versionId);
            setBoxes([]); setPending(undefined); setNotice('');
          }
          pageRef.current = page;
          onPage?.(page);
        }} />}
    </div>
    {boxes.map((box, n) => <span key={n} data-testid="source-highlight" style={{ ...box, position: 'absolute', pointerEvents: 'none', background: '#e9bd3c40', outline: '2px solid #bc861c' }} />)}
    {annotations.map(mark => <button key={mark.ref + String(mark.left) + String(mark.top)} type="button" data-testid="annotation-mark" title={mark.title}
      style={{ left: mark.left, top: mark.top, width: mark.width, height: mark.height, position: 'absolute', padding: 0, border: 0, cursor: 'pointer', background: '#e9bd3c30', outline: '1.5px solid #bc861c' }}
      onClick={() => { cardOpenRequest.request(mark.ref); ctx.layout.selectPanel('studyforge.cards' as MainPanelId); }} />)}
    {pending !== undefined && pending.length > 0 && <button type="button" data-testid="annotation-save" disabled={saving}
      style={boxes.length > 0
        ? { position: 'absolute', left: boxes[boxes.length - 1]!.left, top: boxes[boxes.length - 1]!.top + boxes[boxes.length - 1]!.height + 4 }
        : undefined}
      onClick={() => { void saveAnnotation(); }}>{saving ? '正在存…' : '存为标注'}</button>}
  </div>;
}

function rangeAt(root: HTMLElement, start: number, end: number): Range | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange(); let count = 0, began = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!began && start <= count + length) { range.setStart(node, start - count); began = true; }
    if (began && end <= count + length) { range.setEnd(node, end - count); return range; }
    count += length;
  }
  return undefined;
}
