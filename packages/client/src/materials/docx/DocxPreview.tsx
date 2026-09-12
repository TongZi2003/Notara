/**
 * P3.3 DOCX preview through docx-preview's public `renderAsync` (Apache-2.0,
 * docx-preview@0.4.0). No experimental parser node is used and no page break is
 * claimed as Word's own: the component shows the document's real flow, keeps
 * the previewer's own tables, images and formulas, and marks the rendered
 * paragraphs with the Host's stable block ids when an index came with the bytes.
 *
 * The same component serves both entries — the materials page mounts it
 * directly, and the classroom's document tab mounts it with the tab's bytes —
 * so the two surfaces cannot drift apart.
 */
import { renderAsync } from 'docx-preview';
import { useEffect, useRef, useState } from 'react';
import type { DocxIndex } from '@studyforge/domain/docx';
import { applyDocxDomMap, type DocxDomMap } from './dom-map.ts';

export interface DocxPreviewProps {
  /** The exact immutable bytes of one version; never a rewritten excerpt. */
  readonly data: Uint8Array;
  /** The Host's structural index for these bytes; absent means preview without block ids. */
  readonly index?: DocxIndex | undefined;
  /** Called with the mapping result once a render with an index finishes. */
  readonly onMapped?: ((map: DocxDomMap) => void) | undefined;
}

type DocxState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly positioned: boolean; readonly text: string }
  | { readonly status: 'failed'; readonly text: string };

/** Render one DOCX original into the paper surface. */
export function DocxPreview({ data, index, onMapped }: DocxPreviewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<DocxState>({ status: 'loading' });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let live = true;
    setState({ status: 'loading' });
    // Each request renders into its own detached container. `renderAsync` cannot
    // be cancelled, so a superseded render is left in its own nodes and dropped;
    // only the request that is still current is ever attached to `host`, which
    // is what keeps a slow older document from writing over a newer one.
    const body = document.createElement('div');
    const style = document.createElement('div');
    // The previewer owns its own DOM and styles; the bytes are copied so this
    // component never hands its caller's buffer to the library, and base64 URLs
    // keep every image URL inside this container instead of leaking ObjectURLs.
    const blob = new Blob([data.slice()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    void renderAsync(blob, body, style, {
      className: 'sf-docx',
      inWrapper: false,
      breakPages: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderChanges: false,
      renderAltChunks: false,
      useBase64URL: true,
      experimental: false,
      debug: false,
    }).then(() => {
      if (!live) {
        body.replaceChildren();
        style.replaceChildren();
        return;
      }
      host.replaceChildren(style, body);
      if (index === undefined) {
        setState({ status: 'ready', positioned: false, text: '' });
        return;
      }
      const map = applyDocxDomMap(body, index);
      onMapped?.(map);
      setState({ status: 'ready', positioned: map.positioned, text: mapDescription(map) });
    }, () => {
      body.replaceChildren();
      style.replaceChildren();
      if (!live) return;
      setState({ status: 'failed', text: '这份文档读不出来，可能已经损坏。换成新版本或重新导入一次。' });
    });
    return () => {
      live = false;
      host.replaceChildren();
      body.replaceChildren();
      style.replaceChildren();
    };
  }, [data, index, onMapped]);

  const line = state.status === 'loading' ? '正在把文档排到纸面上…' : state.text;
  return <div className="sf-docx-shell" data-docx-positioned={state.status === 'ready' ? String(state.positioned) : undefined}>
    {line !== '' && <p className="sf-note" role="status" data-testid="docx-status" data-docx-status={state.status}>{line}</p>}
    <span hidden data-testid="docx-state" data-docx-status={state.status} />
    {/* The previewer's page and its injected styles are attached together here. */}
    <div className="sf-docx-body" ref={hostRef} data-testid="docx-body" />
  </div>;
}

/** Say nothing when the whole body is located; say one short line when it is not. */
function mapDescription(map: DocxDomMap): string {
  return map.positioned ? '' : '这份文档有内容没法对应到原位置，先按原文显示。';
}
