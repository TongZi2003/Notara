import type { Context } from '@deepseek-ai/cordis';
import type { ArtifactView, ArtifactCheck } from '@studyforge/contracts/creation';
import { useEffect, useState } from 'react';
import { MarkdownBody } from '../cards/MarkdownBody.tsx';

const drafts = new Map<string, { body: string; digest: string }>();

export function CreationEditor({ ctx, target, onConversation }: { ctx: Context; target: string; onConversation(view: ArtifactView): Promise<void> }): React.JSX.Element {
  const [view, setView] = useState<ArtifactView>(), [path, setPath] = useState<'manifest.json' | 'content.md' | 'index.html'>('content.md');
  const [body, setBody] = useState(''), [base, setBase] = useState(''), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [check, setCheck] = useState<ArtifactCheck>();
  useEffect(() => { let live = true; void ctx.remote.studyforgeCreation.read({ ref: target }).then(result => {
    if (!live) return; if (!result.ok) { setNotice('作品暂时读不出来。'); return; }
    setView(result.value); if (!view && result.value.manifest) setPath(result.value.manifest.entry);
  }).catch(() => { if (live) setNotice('作品暂时读不出来。'); }); return () => { live = false; }; }, [ctx, target, refresh]);
  useEffect(() => {
    if (!view) return;
    const file = view.files.find(item => item.path === path), draft = drafts.get(target + ':' + path);
    setBody(draft?.body ?? file?.body ?? ''); setBase(draft?.digest ?? file?.digest ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); setDirty(!!draft);
  }, [view, path, target]);
  useEffect(() => { let live = true; setCheck(undefined); void ctx.remote.studyforgeCreation.check({ ref: target }).then(result => { if (live && result.ok) setCheck(result.value); }).catch(() => {}); return () => { live = false; }; }, [ctx, target, view]);
  if (!view) return <p role="status">{notice || '正在打开作品…'}</p>;
  const content = view.files.find(file => file.path === view.manifest?.entry)?.body ?? '';
  const latest = view.files.find(file => file.path === path);
  const conflict = dirty && !!latest && base !== latest.digest;
  return <section className="sf-creation-editor" data-testid="creation-editor">
    <header><h2>{view.manifest?.title ?? '编辑作品设置'}</h2><button className="sf-quiet" onClick={() => { void onConversation(view).catch(() => setNotice('暂时没能回到创作对话。')); }}>回到创作对话</button></header>
    <nav><button className="sf-quiet" onClick={() => setPath(view.manifest?.entry ?? 'content.md')}>正文</button><button className="sf-quiet" onClick={() => setPath('manifest.json')}>作品设置</button>
      <button className="sf-quiet" onClick={() => setRefresh(n => n + 1)}>重新读取</button>
      <button className="sf-action" disabled={busy || !dirty} onClick={() => { setBusy(true); setNotice(''); void ctx.remote.studyforgeCreation.save({ ref: target, path, expectedDigest: base, content: body }).then(result => {
        if (!result.ok) { setNotice('文件已变化或暂时不能保存。你的文字保留，重新读取后可对照合并。'); return; }
        drafts.delete(target + ':' + path); setView(result.value); setDirty(false); setNotice('已保存');
      }).catch(() => setNotice('暂时没收到保存结果，可以重试；你的文字保留。')).finally(() => setBusy(false)); }}>保存修改</button>
    </nav>
    {conflict && <details open><summary>对照最新内容</summary><pre>{latest.body}</pre><button className="sf-action" onClick={() => { setBase(latest.digest); drafts.set(target + ':' + path, { body, digest: latest.digest }); }}>以最新版为底稿，保留我的编辑</button></details>}
    {notice && <p role="status">{notice}</p>}
    {check?.issues.map(issue => <p role="status" key={issue}>{issue}</p>)}
    <div className="sf-org-actions"><button className="sf-action" data-testid="install-artifact" disabled={busy || dirty || !check || !!check.issues.length || check.digest !== view.digest} onClick={() => {
      setBusy(true); void ctx.remote.studyforgeCreation.publishArtifact({ ref: target, digest: view.digest, operationId: 'install:' + view.digest + ':' + (check?.installation?.revision ?? 0), expectedVersion: check?.installation?.revision ?? 0 }).then(result => {
        if (!result.ok) { setNotice('作品或原文已变化，请重新读取后再发布。'); return; }
        setCheck({ digest: view.digest, issues: [], installation: result.value }); setNotice(result.value.publication ? '已保存到资料库' : '已安装，可以在课堂中选择'); window.dispatchEvent(new Event('studyforge:learning-changed'));
      }).catch(() => setNotice('暂时没收到发布结果，可用同一版重试。')).finally(() => setBusy(false));
    }}>{view.target ? '应用到原文' : view.manifest?.kind === 'markdown' ? '保存到资料库' : '安装此版本'}</button>
    {check?.installation?.enabled && <button className="sf-quiet" disabled={busy} onClick={() => { const current = check.installation!; setBusy(true); void ctx.remote.studyforgeCreation.setEnabled({ ref: target, expectedVersion: current.revision, operationId: crypto.randomUUID(), enabled: false }).then(result => { if (result.ok) { setCheck({ ...check, installation: result.value }); setNotice('已停用'); } else setNotice('设置已变化，请重新读取。'); }).catch(() => setNotice('暂时没能停用。')).finally(() => setBusy(false)); }}>停用</button>}</div>
    {view.manifestError && <p role="status">作品设置尚未完整，可以在“作品设置”中修改。</p>}
    <div className="sf-creation-columns"><textarea aria-label="作品正文" data-testid="artifact-editor" value={body} spellCheck={false} onChange={event => {
      const value = event.target.value; setBody(value); setDirty(true); drafts.set(target + ':' + path, { body: value, digest: base });
    }} />
      <div className="sf-artifact-preview" data-testid="artifact-preview">
        {view.manifest?.kind === 'html' ? <iframe title="互动演示预览" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">' + content} /> : <MarkdownBody text={content} />}
      </div>
    </div>
  </section>;
}
