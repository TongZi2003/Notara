import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ArtifactKind, ArtifactView } from '@studyforge/contracts/creation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { creationNavigation } from './creation-navigation.ts';
import { CreationEditor } from './CreationEditor.tsx';
import './creation.css';

export const ARTIFACT_LABELS: Record<ArtifactKind, string> = { subject: '学科教法', teaching: '教学模式', skill: '任务技能', html: '互动插件', markdown: '讲义' };

export function CreationWorkspace({ ctx }: { ctx: Context }): React.JSX.Element {
  const selected = useSyncExternalStore(creationNavigation.subscribe, creationNavigation.read);
  const [items, setItems] = useState<ArtifactView[]>([]), [title, setTitle] = useState(''), [kind, setKind] = useState<ArtifactKind>('subject');
  const [subjects, setSubjects] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => { let live = true; void ctx.remote.studyforgeCreation.list().then(result => { if (live) { if (result.ok) setItems(result.value); else setNotice('作品暂时读不出来。'); } }).catch(() => { if (live) setNotice('作品暂时读不出来。'); }); return () => { live = false; }; }, [ctx, refresh]);
  const open = async (view: ArtifactView): Promise<void> => {
    await ctx.sessions.refresh(); ctx.sessions.open(view.sessionId as SessionId); ctx.layout.selectPanel(null);
  };
  return <main className="sf-creation" data-testid="creation-workspace">
    <header><h1>创作</h1><button className="sf-quiet" onClick={() => { if (selected) creationNavigation.select(); else ctx.layout.selectPanel(null); }}>{selected ? '全部作品' : '返回对话'}</button></header>
    {selected ? <CreationEditor key={selected} ctx={ctx} target={selected} onConversation={open} /> : <>
      <form className="sf-creation-new" onSubmit={event => { event.preventDefault(); if (!title.trim() || busy) return; setBusy(true); setNotice('');
        void ctx.remote.studyforgeCreation.create({ operationId: crypto.randomUUID(), title: title.trim(), kind, references: [], subjects: subjects.split(/[、,，]/).map(s => s.trim()).filter(Boolean) }).then(result => {
          if (!result.ok) throw new Error('creation_failed');
          setRefresh(n => n + 1); creationNavigation.select(result.value.ref); setTitle('');
          return open(result.value);
        }).catch(() => setNotice('这次没能创建作品，请重试。')).finally(() => setBusy(false));
      }}>
        <input aria-label="作品名称" placeholder="想一起做什么？" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} />
        <select aria-label="作品类型" value={kind} onChange={event => setKind(event.target.value as ArtifactKind)}>{Object.entries(ARTIFACT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {kind === 'subject' && <input aria-label="适用科目" placeholder="适用科目，如：物理" value={subjects} onChange={event => setSubjects(event.target.value)} />}
        <button className="sf-action" disabled={busy || !title.trim()} type="submit">开始共建</button>
      </form>
      <ul className="sf-creation-list">{items.map(item => <li key={item.ref}><button onClick={() => creationNavigation.select(item.ref)}><strong>{item.manifest?.title ?? '待修复作品'}</strong><small>{item.manifest ? ARTIFACT_LABELS[item.manifest.kind] : '设置待修复'}</small></button><button className="sf-quiet" onClick={() => { void open(item).catch(() => setNotice('对话暂时打不开。')); }}>继续对话</button></li>)}</ul>
    </>}
    {notice && <p role="status">{notice}</p>}
  </main>;
}
