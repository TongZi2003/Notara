import type { Context } from '@deepseek-ai/cordis';
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { MaterialVersionSchema } from '@studyforge/contracts/material-records';
import { MaterialContextSchema } from '@studyforge/contracts/materials';
import type { DocxIndex } from '@studyforge/domain/docx';
import type { SourceReferences } from './source-selection.ts';
import { SourceCapture } from './SourceCapture.tsx';
import { DocxPreview } from './docx/DocxPreview.tsx';
import { PdfViewer } from './pdf/PdfViewer.tsx';
import { MarkdownView } from './MarkdownView.tsx';
const NavigationSchema = z.object({ studyforge: z.object({ source: MaterialContextSchema, version: MaterialVersionSchema }) });
type Props = DocumentPreviewProps & { ctx: Context; references: SourceReferences };
/** Native owner still loads the file and owns tabs, toolbar, split and history. */
export function SourceDocument({ ctx, references, content, useTabInfo, sessionId, resourceAddress }: Props): React.JSX.Element {
  const tab = useTabInfo();
  const parsed = useMemo(() => NavigationSchema.safeParse(tab.tab.navigation.params), [tab.tab.navigation.params]);
  const source = parsed.success ? parsed.data.studyforge : undefined;
  const [page, setPage] = useState<number>();
  const onPage = useCallback((value: number) => { setPage(value); }, []);
  useEffect(() => {
    if (!source || !tab.tab.visible) return;
    return references.browse(String(tab.tab.id), {
      sessionId: String(sessionId), label: source.version.title,
      context: { currentMaterial: { kind: 'source', source: {
        ...source.source, ...(page === undefined ? {} : { locator: { kind: 'pdf' as const, page } }),
      } } },
    });
  }, [source, references, sessionId, tab.tab.id, tab.tab.visible, page]);
  const [index, setIndex] = useState<DocxIndex>();
  const bytes = useMemo(() => content.kind === 'bytes' ? content.data : new TextEncoder().encode(content.text), [content]);
  useEffect(() => {
    let live = true; setIndex(undefined);
    if (source?.version.mediaType.includes('wordprocessingml')) void ctx.remote.studyforgeMaterials.docxIndex(source.source).then(result => {
      if (live && result.ok) setIndex(result.value);
    });
    return () => { live = false; };
  }, [ctx, source]);
  if (source !== undefined) return <SourceCapture key={resourceAddress} ctx={ctx} version={source.version} data={bytes} index={index}
    references={references} sessionId={String(sessionId)} locator={source.source.locator} onPage={onPage} />;
  return <UnboundDocument address={resourceAddress} data={bytes} />;
}
/** Ordinary native files remain readable without inventing a material identity. */
function UnboundDocument({ address, data }: { address: string; data: Uint8Array }): React.JSX.Element {
  const name = decodeURIComponent(address.split('/').at(-1) ?? '');
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(new Blob([data.slice()])); setUrl(value); return () => { URL.revokeObjectURL(value); }; }, [data]);
  if (/\.docx$/i.test(name)) return <DocxPreview data={data} />;
  if (/\.pdf$/i.test(name)) return <PdfViewer data={data} title={name} />;
  if (/\.(png|jpg|jpeg|webp)$/i.test(name)) return <img src={url} alt={name} style={{ maxWidth: '100%' }} />;
  const text = new TextDecoder().decode(data);
  return /\.md$/i.test(name) ? <MarkdownView text={text} /> : <pre>{text}</pre>;
}
