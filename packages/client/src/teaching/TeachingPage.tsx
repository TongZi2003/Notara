import type { Context } from '@deepseek-ai/cordis';
import type { TeachingNode, TeachingResource } from '@studyforge/contracts/teaching';
import { useEffect, useState } from 'react';
import { useStableOperationId, attemptKey } from '../cards/attempt.ts';
import './teaching.css';

const GROUPS: readonly { kind: TeachingNode['kind']; title: string; note: string }[] = [
  { kind: 'base', title: '共同规则', note: '每节课都会带上的共同约定' },
  { kind: 'guided', title: '诊断与路线引导', note: '规划学习路线时的引导规则' },
  { kind: 'preset', title: '教学预设', note: '课程里可选的教学方式' },
  { kind: 'skill', title: '任务技能', note: '老师和你可以按需调用的技能' },
  { kind: 'assistant', title: '委派角色', note: '独立帮手收到的人格说明' },
  { kind: 'artifact', title: '已安装教法', note: '作品与插件提供的教法，在作品页编辑' },
];

/**
 * The teaching texts as the student's own pages: every file the teacher runs
 * under is listed, the effective body is readable in full, and bundled texts
 * take a workspace override through the same CAS write path everything else
 * uses. Installed artifacts stay version-frozen; their edits live in creation.
 */
export function TeachingPage({ ctx }: { ctx: Context }): React.JSX.Element {
  const [nodes, setNodes] = useState<TeachingNode[]>([]);
  const [selected, setSelected] = useState<string>();
  const [resource, setResource] = useState<TeachingResource>();
  const [draft, setDraft] = useState('');
  const [showBundled, setShowBundled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const operationFor = useStableOperationId();

  const refresh = async (): Promise<void> => {
    const result = await ctx.remote.studyforgeTeaching.resources();
    if (!result.ok) throw new Error('教法列表暂时无法读取，请重试。');
    setNodes(result.value);
  };
  const open = async (nodeId: string, silent = false): Promise<void> => {
    const result = await ctx.remote.studyforgeTeaching.resource({ nodeId });
    if (!result.ok) { if (!silent) setNotice('这份教法暂时读不出来。'); return; }
    setSelected(nodeId); setResource(result.value); setDraft(result.value.body); setShowBundled(false);
    if (!silent) setNotice('');
  };
  useEffect(() => { let live = true;
    const read = (): void => { void refresh().catch(() => { if (live) setNotice('教法列表暂时无法读取，请重试。'); }); };
    read(); window.addEventListener('focus', read);
    return () => { live = false; window.removeEventListener('focus', read); };
  }, [ctx]);
  useEffect(() => { if (selected) void open(selected, true); }, [nodes]);

  const dirty = resource !== undefined && draft !== resource.body;
  const save = async (): Promise<void> => {
    if (!resource || !dirty) return;
    setBusy(true); setNotice('');
    try {
      const result = await ctx.remote.studyforgeTeaching.saveResource({ nodeId: resource.id, body: draft,
        expectedVersion: resource.version ?? 0, operationId: operationFor(attemptKey('teaching-save', resource.id, draft)) });
      if (!result.ok) { setNotice(result.error.message === 'version_conflict' ? '这份教法刚被改过，已读回最新版，请核对后再保存。' : '暂时没能保存，请重试。'); if (result.error.message === 'version_conflict') await open(resource.id, true); return; }
      setResource(result.value); setDraft(result.value.body); setNotice('已保存。这节课之后的请求会用新版本。');
      await refresh();
    } catch { setNotice('暂时没有收到保存结果，可以原样再试一次。'); }
    finally { setBusy(false); }
  };
  const reset = async (): Promise<void> => {
    if (!resource?.overridden || resource.version === null) return;
    setBusy(true); setNotice('');
    try {
      const result = await ctx.remote.studyforgeTeaching.resetResource({ nodeId: resource.id,
        expectedVersion: resource.version, operationId: operationFor(attemptKey('teaching-reset', resource.id, String(resource.version))) });
      if (!result.ok) { setNotice('暂时没能恢复默认，请重试。'); return; }
      setResource(result.value); setDraft(result.value.body); setNotice('已恢复内置版本。');
      await refresh();
    } catch { setNotice('暂时没有收到结果，可以再试一次。'); }
    finally { setBusy(false); }
  };

  return <main className="sf-page sf-teaching" data-testid="studyforge-teaching-page">
    <header className="sf-page-head"><span className="sf-kicker">教法</span></header>
    <div className="sf-teaching-body">
      <nav className="sf-teaching-tree" aria-label="教法树">
        {GROUPS.map(group => {
          const rows = nodes.filter(node => node.kind === group.kind);
          if (rows.length === 0) return null;
          return <section key={group.kind}>
            <h3>{group.title}<small>{group.note}</small></h3>
            <ul>{rows.map(node => <li key={node.id}>
              <button type="button" aria-pressed={selected === node.id} onClick={() => { void open(node.id); }}>
                <span>{node.title}</span>
                {node.overridden && <em>已修改</em>}
                {node.origin !== 'bundled' && <i>{node.origin === 'plugin' ? '插件' : '作品'}</i>}
              </button>
            </li>)}</ul>
          </section>;
        })}
      </nav>
      <section className="sf-teaching-editor" aria-label="教法正文">
        {!resource ? <p className="sf-note">从左边选一份教法看它的完整正文；它写着老师在你的课堂上被要求怎样做。</p> : <>
          <header className="sf-teaching-editor-head">
            <h2>{resource.title}</h2>
            <span className="sf-meta">{resource.origin === 'bundled' ? '内置' : resource.origin === 'plugin' ? '插件提供' : '作品提供'}
              {resource.overridden ? ' · 本空间已修改' : ' · 原始版本'}{resource.version !== null ? ` · 第 ${resource.version} 版` : ''}</span>
          </header>
          {!resource.editable ? <>
            <pre className="sf-teaching-text" data-testid="teaching-body">{resource.body}</pre>
            <p className="sf-note">已安装的教法按版本固定，在作品页里编辑出新版。</p>
          </> : <>
            <textarea className="sf-teaching-text" data-testid="teaching-editor" value={draft} disabled={busy}
              onChange={event => setDraft(event.target.value)} spellCheck={false} />
            {resource.overridden && <p className="sf-note">
              <button type="button" className="sf-quiet" onClick={() => setShowBundled(!showBundled)}>{showBundled ? '收起内置原文' : '对照内置原文'}</button>
            </p>}
            {showBundled && resource.bundledBody !== null && <pre className="sf-teaching-text sf-teaching-bundled" data-testid="teaching-bundled">{resource.bundledBody}</pre>}
            <div className="sf-teaching-actions">
              <button type="button" className="sf-action" data-testid="teaching-save" disabled={busy || !dirty} onClick={() => { void save(); }}>{busy ? '正在保存…' : '保存修改'}</button>
              {resource.overridden && <button type="button" className="sf-quiet" data-testid="teaching-reset" disabled={busy} onClick={() => { void reset(); }}>恢复内置版本</button>}
            </div>
          </>}
        </>}
        {notice && <p className="sf-note" role="status" data-testid="teaching-notice">{notice}</p>}
      </section>
    </div>
  </main>;
}

export function registerTeaching(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.teaching', priority: -20 }, () => <TeachingPage ctx={ctx} />)));
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'studyforge.teaching', order: 47, label: '教法' }, TeachingIcon)));
}

function TeachingIcon(): React.JSX.Element {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M4 3h9l3 3v11H4zM12 3v4h4M7 9h6M7 12h6M7 15h4" /></svg>;
}
