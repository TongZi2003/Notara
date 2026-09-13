import type { Context } from '@deepseek-ai/cordis';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImportMaterial } from '../materials/ImportMaterial.tsx';
import { titleFromFileName } from '../materials/files.ts';
import { useLessonUploads } from './lesson-uploads.ts';
import './lesson-import.css';

/** One import workflow, presented in the composer, empty desk and 开始 page. */
export function LessonImport({ ctx, sessionId, active = true, appearance = 'sheet', onOpen }: {
  ctx: Context; sessionId: string; active?: boolean; appearance?: 'sheet' | 'classroom' | 'compact'; onOpen(material: MaterialView): void;
}): React.JSX.Element {
  const { rows, busy, files, retry } = useLessonUploads(ctx, sessionId);
  const [receipts, setReceipts] = useState(false);
  const anchor = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null);
  const [popupLeft, setPopupLeft] = useState(0);
  useLayoutEffect(() => {
    if (!receipts || appearance !== 'compact') return;
    const place = (): void => {
      if (!anchor.current || !popup.current) return;
      const left = anchor.current.getBoundingClientRect().left;
      setPopupLeft(Math.max(12, Math.min(left, window.innerWidth - popup.current.offsetWidth - 12)) - left);
    };
    place();
    const observer = new ResizeObserver(place);
    const card = anchor.current?.closest('[data-composer-card]');
    if (card) observer.observe(card);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [receipts, appearance]);
  const needsAttention = rows.some(row => row.status === 'retry' || row.status === 'refused');
  useEffect(() => { if (needsAttention) setReceipts(true); }, [needsAttention, rows]);
  const results = <ul className="sf-upload-results" aria-label="上传结果">{rows.map(row => <li key={row.id}>
    {row.status === 'saved' && row.material ? <button type="button" onClick={() => { onOpen(row.material!); }}>{row.material.title}</button>
      : <span>{titleFromFileName(row.file.name)}</span>}
    <small role="status">{row.message}</small>
    {row.status === 'retry' && <button type="button" disabled={busy} onClick={() => { retry(row); }}>重试</button>}
  </li>)}</ul>;
  return <div className="sf-lesson-import" ref={anchor} data-appearance={appearance} data-testid={appearance === 'compact' ? 'composer-import' : 'lesson-import'}>
    <ImportMaterial pending={busy} active={active} pasteScope="control" appearance={appearance} onFiles={files} />
    {appearance === 'compact' ? rows.length > 0 && <>
      <button type="button" className="sf-upload-status" data-testid="import-results-toggle" aria-label="查看导入结果" aria-expanded={receipts}
        title={busy ? '正在收下资料' : needsAttention ? '查看需要处理的资料' : '资料已收好'} onClick={() => { setReceipts(!receipts); }}>{busy ? '…' : needsAttention ? '!' : '✓'}</button>
      {receipts && <div className="sf-upload-popover" ref={popup} style={{ left: popupLeft }} role="region" aria-label="导入结果" data-testid="composer-import-results">
        <button type="button" className="sf-upload-close" aria-label="收起导入结果" onClick={() => { setReceipts(false); }}>×</button>
        {results}
      </div>}
    </> : rows.length > 0 && results}
  </div>;
}
