import type { Context } from '@deepseek-ai/cordis';
import type { MaterialView, MaterialVersion } from '@studyforge/contracts/material-records';
import { useState, useRef } from 'react';
import { decodeBase64, decodeText, encodeBase64 } from './files.ts';
import { openCreation } from '../creation/creation-navigation.ts';
export function MaterialEditor({ ctx, view, version, onSaved }: { ctx: Context; view: MaterialView; version: MaterialVersion; onSaved(saved: MaterialView): void }): React.JSX.Element | null {
  const [body, setBody] = useState<string>(), [base, setBase] = useState(view.revision), [latest, setLatest] = useState<{ body: string; revision: number }>(), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const attempt = useRef<{ key: string; id: string }>();
  if (!['text/plain', 'text/markdown'].includes(version.mediaType)) return null;
  if (version.versionId !== view.currentVersion.versionId) return null;
  const load = async (): Promise<string> => { const reply = await ctx.remote.studyforgeMaterials.bytes({ materialId: view.materialId, versionId: version.versionId }); if (!reply.ok) throw new Error('unavailable'); return decodeText(decodeBase64(reply.value.base64)); };
  return <section className="sf-material-coedit"><div className="sf-org-actions"><button className="sf-quiet" onClick={() => { void load().then(text => { setBody(text); setBase(view.revision); }).catch(() => setNotice('原文暂时读不出来。')); }}>编辑原文</button><button className="sf-quiet" disabled={busy} onClick={() => {
    setBusy(true); void load().then(content => ctx.remote.studyforgeCreation.create({ operationId: crypto.randomUUID(), title: view.title, kind: 'markdown', references: [{ materialId: view.materialId, versionId: version.versionId }], target: { ref: 'material:' + view.materialId, version: view.revision }, content })).then(reply => { if (reply.ok) openCreation(ctx, reply.value.ref); else setNotice('原文已变化，请重新打开后再共同编辑。'); }).catch(() => setNotice('暂时没能准备共建草稿。')).finally(() => setBusy(false));
  }}>和 AI 共同编辑</button></div>
    {body !== undefined && <><textarea aria-label="编辑原文正文" value={body} onChange={e => setBody(e.target.value)} /><div className="sf-org-actions"><button className="sf-action" disabled={busy} onClick={() => {
      const key = JSON.stringify([view.materialId, base, body]); if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      setBusy(true); void ctx.remote.studyforgeMaterials.createVersion({ operationId: attempt.current.id, expectedVersion: base, material: { materialId: view.materialId, title: view.title, fileName: version.fileName, mediaType: version.mediaType }, base64: encodeBase64(new TextEncoder().encode(body)) }).then(async reply => {
        if (reply.ok) { setBody(undefined); onSaved(reply.value); setNotice('已保存新版本'); return; }
        const list = await ctx.remote.studyforgeMaterials.list(); const now = list.ok ? list.value.find(item => item.materialId === view.materialId) : undefined;
        if (now) { const bytes = await ctx.remote.studyforgeMaterials.bytes({ materialId: now.materialId, versionId: now.currentVersion.versionId }); if (bytes.ok) setLatest({ body: decodeText(decodeBase64(bytes.value.base64)), revision: now.revision }); }
        setNotice('原文已有变化。你的编辑保留，请对照最新版再保存。');
      }).catch(() => setNotice('暂时没收到结果，可保留原稿重试。')).finally(() => setBusy(false));
    }}>保存新版本</button><button className="sf-quiet" onClick={() => setBody(undefined)}>收起编辑</button></div></>}
    {latest && <details open><summary>最新原文</summary><pre>{latest.body}</pre><button onClick={() => { setBase(latest.revision); setLatest(undefined); }}>以此为底稿，保留我的编辑</button></details>}{notice && <p role="status">{notice}</p>}
  </section>;
}
