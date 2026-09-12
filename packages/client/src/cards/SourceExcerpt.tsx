import type { Context } from '@deepseek-ai/cordis';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import type { MaterialRead } from '@studyforge/contracts/material-read';
import { useEffect, useState } from 'react';
import { MarkdownBody } from './MarkdownBody.tsx';

/** A source-only card shows its actual fixed excerpt, never an empty face. */
export function SourceExcerpt({ ctx, sources }: { ctx: Context; sources: readonly SourceAnchor[] }): React.JSX.Element {
  const [readings, setReadings] = useState<(MaterialRead | null)[]>();
  useEffect(() => {
    let live = true; setReadings(undefined);
    void Promise.all(sources.map(async ({ quote: _quote, ...source }) => {
      try { const result = await ctx.remote.studyforgeMaterials.read({ source }); return result.ok ? result.value : null; }
      catch { return null; }
    })).then(rows => { if (live) setReadings(rows); });
    return () => { live = false; };
  }, [ctx, sources]);
  return <div data-testid="card-source-excerpt">
    {!readings && <p role="status">正在读取原处…</p>}
    {readings?.map((reading, index) => reading ? <div key={index}>
      <p className="sf-meta">{reading.title}</p>
      {reading.image && <img alt={reading.title + ' · 原文选段'} src={'data:' + reading.image.mediaType + ';base64,' + reading.image.base64} style={{ maxWidth: '100%', height: 'auto' }} />}
      {reading.text && <MarkdownBody text={reading.text} />}
      {reading.truncated && <p className="sf-note">这里显示了一部分，完整内容请打开原文。</p>}
    </div> : <p role="status" key={index}>这一处原文暂时读不到，可以稍后再试。</p>)}
  </div>;
}
