/**
 * P3.4 a book's own read-only table of contents.
 *
 * The nodes and their anchors come from the Host's skeleton read of that
 * material, so every entry here is a position somebody actually read — nothing
 * is guessed from a quote and nothing is invented for an unbroken book. Reading
 * this page never writes a skeleton: a book that has not been broken down yet
 * has none, and that absence is left as it is (editing lives in the later map
 * work). An empty book and a read that did not arrive are kept apart: only the
 * first is silent, the second says so and can be asked again. Anchors may pin
 * older versions of the same book, so an entry says which version it was
 * written from when that is not the one on screen.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SourceLocator } from '@studyforge/contracts/materials';
import type { MaterialView, MaterialVersion } from '@studyforge/contracts/material-records';
import type { SkeletonNode, SkeletonView } from '@studyforge/contracts/skeleton';
import { useEffect, useState } from 'react';
// The format rule itself lives in `book-format.ts` (pure, shared with the map's
// projection); this module keeps the name its callers already import.
export { isBookFormat } from './book-format.ts';

type OutlineState =
  /** Read back fine and the book simply has no sections yet. */
  | { readonly status: 'empty' }
  /** The read itself did not come back: a different thing from an empty book. */
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly nodes: readonly SkeletonNode[] };

export interface MaterialOutlineProps {
  readonly view: MaterialView;
  /** The version currently on screen; an anchor from another one says so. */
  readonly version: MaterialVersion;
  skeleton(input: { readonly materialId: string }): Promise<RemoteResult<SkeletonView>>;
}

/** One book's saved sections, read once per material. */
export function MaterialOutline({ view, version, skeleton }: MaterialOutlineProps): React.JSX.Element | null {
  const [state, setState] = useState<OutlineState>({ status: 'empty' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: 'empty' });
    void (async () => {
      try {
        const read = await skeleton({ materialId: view.materialId });
        if (!live) return;
        // An unbroken book really has no sections, and that is not an error. A
        // read that was refused or never arrived is a different fact: it says
        // nothing about the book, so it is shown as a failed read and can be
        // asked again — never as "this book has no contents".
        if (!read.ok) { setState({ status: 'failed' }); return; }
        setState(read.value.nodes.length > 0 ? { status: 'ready', nodes: read.value.nodes } : { status: 'empty' });
      } catch {
        if (live) setState({ status: 'failed' });
      }
    })();
    return () => { live = false; };
  }, [skeleton, view.materialId, attempt]);

  if (state.status === 'failed') return <section className="sf-material-outline" data-testid="material-outline-failed" role="status">
    <p className="sf-note">目录暂时没取到。</p>
    <button type="button" className="sf-action sf-action-quiet" data-testid="material-outline-retry"
      onClick={() => { setAttempt(count => count + 1); }}>再试一次</button>
  </section>;
  if (state.status === 'empty') return null;
  return <section className="sf-material-outline" data-testid="material-outline" aria-label="目录">
    <h3>目录</h3>
    <ol>{state.nodes.map(node => <li key={node.path} data-testid="material-outline-node" data-node-path={node.path}>
      <span className="sf-outline-path">{node.path}</span>
      <span className="sf-meta">{describeSources(node, view, version)}</span>
    </li>)}</ol>
  </section>;
}

/** Where this section was read from, in the student's own coordinates. */
function describeSources(node: SkeletonNode, view: MaterialView, version: MaterialVersion): string {
  const parts = node.sources.map(anchor => {
    const where = describeLocator(anchor.locator);
    const index = view.versions.findIndex(item => item.versionId === anchor.versionId);
    // Anchors keep resolving the version they were written from; saying so is
    // the difference between "this moved" and "this was read from an older copy".
    const older = index >= 0 && index !== view.versions.length - 1 && anchor.versionId !== version.versionId;
    return older ? `${where}（写自第 ${String(index + 1)} 版）` : where;
  });
  return [...new Set(parts)].join('、');
}

function describeLocator(locator: SourceLocator): string {
  switch (locator.kind) {
    case 'pdf': return `第 ${String(locator.page)} 页`;
    case 'pdftext': return `第 ${String(locator.page)} 页摘录`;
    case 'text': return locator.start.line === locator.end.line
      ? `第 ${String(locator.start.line)} 行` : `第 ${String(locator.start.line)}–${String(locator.end.line)} 行`;
    case 'image': return '图中的位置';
    case 'docx': return 'Word 正文';
  }
}
