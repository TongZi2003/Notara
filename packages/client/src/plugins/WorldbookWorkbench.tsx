import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useState } from 'react';
import { WorldbookDocumentSchema, type WorldbookDocument, type WorldbookView, type WorldbookSelection } from '@studyforge/contracts/plugins';

export function WorldbookWorkbench({ ctx, sessionId, id }: { ctx: Context; sessionId: string; id: string }): React.JSX.Element {
  const [view, setView] = useState<WorldbookView>(), [document, setDocument] = useState<WorldbookDocument>({ entries: [] });
  const [selected, setSelected] = useState<number>(), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''), [preview, setPreview] = useState<WorldbookSelection>();
  const load = async (): Promise<void> => { const result = await ctx.remote.studyforgePlugins.readWorldbook({ sessionId, id }); if (result.ok) { setView(result.value); setDocument(result.value.document); setDirty(false); setNotice(''); } else setNotice('世界书暂时无法读取，请检查插件状态后重试。'); };
  useEffect(() => { void load().catch(() => setNotice('世界书暂时无法读取。')); }, [ctx, sessionId, id]);
  const edit = (next: WorldbookDocument): void => { setDocument(next); setDirty(true); setPreview(undefined); };
  const entry = selected === undefined ? undefined : document.entries[selected];
  const patch = (value: Partial<WorldbookDocument['entries'][number]>): void => { edit({ entries: document.entries.map((item, index) => index === selected ? { ...item, ...value } : item) }); };
  return <section className="sf-worldbook" data-editing={!!entry}>
    <header><label className="sf-worldbook-switch"><input type="checkbox" checked={view?.enabled ?? false} disabled={busy || !view} onChange={event => {
      setBusy(true); void ctx.remote.studyforgePlugins.useWorldbook({ sessionId, id, expectedVersion: view!.useRevision, enabled: event.target.checked }).then(reply => {
        if (reply.ok) { setView(current => current ? { ...current, enabled: reply.value.enabled, useRevision: reply.value.useRevision } : current); setNotice(reply.value.enabled ? '本课已启用，下一条消息开始使用。' : '本课已停用。'); } else setNotice('启用状态已变化，请重新加载后重试。');
      }).catch(() => setNotice('状态未能更新，请重试。')).finally(() => setBusy(false));
    }} />本课启用</label><button className="sf-action" disabled={!dirty || busy || !view} onClick={() => {
      if (!WorldbookDocumentSchema.safeParse(document).success) { setNotice('请填写条目标题与内容；每条最多2000字，关键词用逗号分隔。'); return; }
      setBusy(true); void ctx.remote.studyforgePlugins.saveWorldbook({ sessionId, id, expectedVersion: view!.revision, operationId: crypto.randomUUID(), document }).then(reply => {
        if (reply.ok) { setView(reply.value); setDocument(reply.value.document); setDirty(false); setNotice('已保存，已启用的课堂下一轮使用新内容。'); }
        else setNotice('未能保存，内容可能已在别处修改。当前草稿仍保留，可先导出，再重新加载。');
      }).catch(() => setNotice('暂时没收到保存结果。请先导出草稿，再重新加载核对。')).finally(() => setBusy(false));
    }}>{busy ? '处理中…' : dirty ? '保存修改' : '已保存'}</button></header>
    {notice && <p className="sf-worldbook-notice" role="status">{notice}</p>}
    <div className="sf-worldbook-body">
      <nav aria-label="世界书条目"><div className="sf-worldbook-list-head"><span>{document.entries.length} 条背景</span><button className="sf-quiet" aria-label="新增条目" disabled={busy || !view || document.entries.length >= 60} onClick={() => { edit({ entries: [...document.entries, { title: '新条目', content: '', keywords: [], enabled: true, always: false }] }); setSelected(document.entries.length); }}>＋</button></div>
        {document.entries.map((item, index) => <button key={index} className="sf-worldbook-item" aria-pressed={selected === index} onClick={() => setSelected(index)}><span>{item.title || '未命名'}</span><small>{!item.enabled ? '已关闭' : item.always ? '始终带入' : item.keywords.length ? item.keywords.join(' · ') : '待设关键词'}</small></button>)}
        <details className="sf-worldbook-preview"><summary>试查触发内容</summary><label>试写一句话<input value={query} maxLength={4000} onChange={event => setQuery(event.target.value)} placeholder="例如：城邦该怎样分配水源？" /></label><button className="sf-quiet" disabled={dirty || busy || !view} onClick={() => { void ctx.remote.studyforgePlugins.previewWorldbook({ sessionId, id, query }).then(reply => { if (reply.ok) setPreview(reply.value); else setNotice('试查未完成，请重试。'); }).catch(() => setNotice('试查未完成，请重试。')); }}>查看命中</button>{dirty && <p>保存修改后可试查。</p>}{preview && <div role="status">{preview.entries.length ? preview.entries.map(item => <p key={item.title}>· {item.title}</p>) : <p>没有命中条目</p>}{preview.omitted > 0 && <p>{preview.omitted} 条超过本轮容量</p>}</div>}</details>
        <footer><button className="sf-quiet" disabled={busy} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })); const a = window.document.createElement('a'); a.href = url; a.download = '世界书.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>导出内容</button><button className="sf-quiet" disabled={busy} onClick={() => { if (dirty && !window.confirm('重新加载会替换尚未保存的草稿。继续？')) return; void load().catch(() => setNotice('重新加载失败，草稿仍保留。')); }}>重新加载</button></footer>
      </nav>
      <section className="sf-worldbook-editor" aria-label="编辑世界书条目">
        {entry ? <><button className="sf-quiet sf-worldbook-back" onClick={() => setSelected(undefined)}>‹ 所有条目</button><label>标题<input disabled={busy} value={entry.title} maxLength={120} onChange={event => patch({ title: event.target.value })} /></label>
          <div className="sf-worldbook-options"><label><input type="checkbox" disabled={busy} checked={entry.enabled} onChange={event => patch({ enabled: event.target.checked })} />启用条目</label><label><input type="checkbox" disabled={busy} checked={entry.always} onChange={event => patch({ always: event.target.checked })} />始终带入</label></div>
          {!entry.always && <label>触发关键词<input disabled={busy} value={entry.keywords.join('，')} onChange={event => patch({ keywords: event.target.value.split(/[,，]/) })} onBlur={() => patch({ keywords: entry.keywords.map(word => word.trim()).filter(Boolean) })} placeholder="用逗号分隔" /><small>匹配消息中出现的任意关键词。</small></label>}
          <label className="sf-worldbook-content">背景内容<textarea disabled={busy} value={entry.content} maxLength={2000} onChange={event => patch({ content: event.target.value })} placeholder="写下术语、人物、背景或情境规则。" /><small>{entry.content.length} / 2000</small></label>
          <button className="sf-quiet sf-worldbook-delete" disabled={busy} onClick={() => { if (!window.confirm('删除这个条目？保存修改后生效。')) return; edit({ entries: document.entries.filter((_, index) => index !== selected) }); setSelected(undefined); }}>删除条目</button></> : <div className="sf-worldbook-intro"><svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M20 9C13 5 7 7 4 8v24c6-3 11-2 16 1 5-3 10-4 16-1V8c-4-1-10-3-16 1zm0 0v24M9 14l6 1m-6 5 6 1m10-6 6-1m-6 7 6-1" /></svg><h3>为这节课补充背景</h3><p>选择条目编辑，在本课启用后按消息带入。</p><small>内容跨课共用，启用状态只属于本课。</small></div>}
      </section>
    </div>
  </section>;
}
