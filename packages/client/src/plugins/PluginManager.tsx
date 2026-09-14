import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useState } from 'react';
import type { PluginCandidate, PluginSource, PluginView } from '@studyforge/contracts/plugins';
import './plugins.css';
import { openCreation } from '../creation/creation-navigation.ts';

export const notifyPlugins = (): void => { window.dispatchEvent(new Event('studyforge:learning-changed')); };
const STATUS = { enabled: '已启用', installed: '已安装 · 未启用', failed: '加载失败', 'restart-required': '需要重启' };
const names = (plugin: PluginCandidate | PluginView): { kind: string; title: string }[] => {
  const value = plugin.manifest.notara;
  return [...value.skills.map(row => ({ kind: '技能', title: row.title })), ...value.workbenches.map(row => ({ kind: '工作台', title: row.title })), ...value.worldbooks.map(row => ({ kind: '世界书', title: row.title })), ...value.teaching.map(row => ({ kind: '教学模式', title: row.title })), ...value.subjects.map(row => ({ kind: '科目教法', title: row.title }))];
};
async function base64(file: File): Promise<string> {
  if (file.size > 30_000_000) throw new Error('插件包不能超过 30 MB。');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('文件读取失败，请重新选择。')); reader.readAsDataURL(file); });
}
export function PluginManagerPage({ ctx }: { ctx: Context }): React.JSX.Element {
  const [rows, setRows] = useState<PluginView[]>([]), [selected, setSelected] = useState<string>(), [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false), [updating, setUpdating] = useState<string>(), [candidate, setCandidate] = useState<PluginCandidate>();
  const [sourceKind, setSourceKind] = useState<'archive' | 'directory'>('archive'), [path, setPath] = useState(''), [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [trust, setTrust] = useState(false), [removing, setRemoving] = useState(false);
  const refresh = async (): Promise<void> => { const result = await ctx.remote.studyforgePlugins.list(); if (!result.ok) throw new Error('插件列表暂时无法读取，请重试。'); setRows(result.value); setLoading(false); };
  useEffect(() => { let live = true; const read = (): void => { if (live) void refresh().catch(() => { if (live) { setNotice('插件列表暂时无法读取，请重试。'); setLoading(false); } }); }; read(); window.addEventListener('focus', read); window.addEventListener('studyforge:learning-changed', read); return () => { live = false; window.removeEventListener('focus', read); window.removeEventListener('studyforge:learning-changed', read); }; }, [ctx]);
  const plugin = rows.find(row => row.ref === selected);
  const action = async (fn: () => Promise<void>): Promise<void> => { setBusy(true); setNotice(''); try { await fn(); await refresh(); notifyPlugins(); } catch (error) { setNotice(error instanceof Error ? error.message : '操作未完成，请重试。'); } finally { setBusy(false); } };
  const openInstall = (ref?: string): void => { setUpdating(ref); setInstalling(true); setCandidate(undefined); setTrust(false); setFile(undefined); setPath(''); setNotice(''); };
  return <main className="sf-plugins-page" data-testid="plugin-manager">
    <header><h1>插件</h1><button className="sf-action" onClick={() => openInstall()}>安装插件</button></header>
    {notice && <p role="status" className="sf-plugin-notice">{notice}<button className="sf-quiet" disabled={busy} onClick={() => { void action(async () => {}); }}>刷新</button></p>}
    <div className="sf-plugins-body" data-detail={!!plugin}>
      <section className="sf-plugin-list" aria-label="已安装插件">
        {loading ? <p>正在读取插件…</p> : !rows.length ? <div className="sf-plugin-empty"><PluginIcon /><h2>尚未安装插件</h2><p>安装技能或工作台，扩展你的笔记本。</p></div> : rows.map(row => <button key={row.ref} className="sf-plugin-row" aria-pressed={selected === row.ref} onClick={() => { setSelected(row.ref); setRemoving(false); }}>
          <PluginIcon /><span><strong>{row.title}</strong><small>{row.description || names(row).map(item => item.title).join('、')}</small><span className="sf-plugin-state" data-state={row.state}>{STATUS[row.state]}</span></span><small>v{row.version}</small><span aria-hidden="true">›</span>
        </button>)}
      </section>
      {plugin && <aside className="sf-plugin-detail" aria-label="插件详情">
        <header><button className="sf-quiet" onClick={() => setSelected(undefined)}>返回列表</button><span>{STATUS[plugin.state]}</span></header>
        <PluginIcon /><h2>{plugin.title}</h2><p>{plugin.description}</p><small>版本 {plugin.version}</small>
        <h3>新增能力</h3><ul>{names(plugin).map(item => <li key={item.kind + item.title}><span>{item.title}</span><small>{item.kind}</small></li>)}</ul>
        <h3>权限</h3><p>{plugin.native ? '运行本机代码。仅启用你信任的来源。' : '技能按需读取；工作台在隔离环境中运行。'}{plugin.manifest.notara.workbenches.some(row => row.permissions.includes('save-note')) ? '保存笔记前会展示内容并由你确认。' : ''}</p>
        {plugin.issue && <p role="status">{plugin.issue}</p>}
        {plugin.state === 'restart-required' && <p>已有课堂继续使用当前版本，重启应用后完成变更。</p>}
        <div className="sf-plugin-actions"><button className="sf-action" disabled={busy || plugin.state === 'restart-required'} onClick={() => { void action(async () => {
          const result = await ctx.remote.studyforgePlugins.setEnabled({ ref: plugin.ref, expectedVersion: plugin.revision, enabled: plugin.state === 'failed' || !plugin.enabled });
          if (!result.ok) throw new Error('插件状态已变化，刷新后重试。');
        }); }}>{plugin.state === 'failed' ? '重新启用' : plugin.enabled ? '停用' : '启用'}</button><button className="sf-quiet" disabled={busy} onClick={() => plugin.creationRef ? openCreation(ctx, plugin.creationRef) : openInstall(plugin.ref)}>{plugin.creationRef ? '编辑作品' : '更新'}</button><button className="sf-quiet" disabled={busy} onClick={() => setRemoving(true)}>卸载</button></div>
        {removing && <section className="sf-plugin-remove" aria-label="确认卸载"><p>卸载“{plugin.title}”？已保存的笔记和学习记录会保留。</p><div className="sf-plugin-actions"><button className="sf-action" disabled={busy} onClick={() => { void action(async () => { const result = await ctx.remote.studyforgePlugins.uninstallPackage({ ref: plugin.ref, expectedVersion: plugin.revision }); if (!result.ok) throw new Error('暂时无法卸载，请刷新后重试。'); setRemoving(false); if (result.value.state !== 'restart-required') setSelected(undefined); }); }}>确认卸载</button><button className="sf-quiet" disabled={busy} onClick={() => setRemoving(false)}>取消</button></div></section>}
      </aside>}
    </div>
    {installing && <div className="sf-plugin-modal-backdrop"><section className="sf-plugin-modal" role="dialog" aria-modal="true" aria-label={updating ? '更新插件' : '安装插件'}>
      <header><h2>{updating ? '更新插件' : '安装插件'}</h2><button className="sf-quiet" aria-label="关闭安装" disabled={busy} onClick={() => setInstalling(false)}>×</button></header>
      {!candidate ? <><div className="sf-plugin-source" role="group" aria-label="安装来源"><button className="sf-quiet" aria-pressed={sourceKind === 'archive'} onClick={() => setSourceKind('archive')}>本地插件包</button><button className="sf-quiet" aria-pressed={sourceKind === 'directory'} onClick={() => setSourceKind('directory')}>开发目录</button></div>
        {sourceKind === 'archive' ? <label>选择插件包<input type="file" accept=".tgz,.tar.gz" aria-label="插件包" onChange={event => setFile(event.target.files?.[0])} /><small>支持 .tgz 或 .tar.gz，最大 30 MB</small></label> : <label>插件目录<input aria-label="插件目录" value={path} onChange={event => setPath(event.target.value)} placeholder="包含 package.json 的目录" /></label>}
        <button className="sf-action" disabled={busy || (sourceKind === 'archive' ? !file : !path.trim())} onClick={() => { void action(async () => {
          const input: PluginSource = sourceKind === 'archive' ? { kind: 'archive', fileName: file!.name, base64: await base64(file!) } : { kind: 'directory', path: path.trim() };
          const result = await ctx.remote.studyforgePlugins.prepare(input); if (!result.ok) throw new Error('无法读取这个插件。请检查插件声明、入口文件和依赖；原有插件未改变。');
          if (updating && result.value.current?.ref !== updating) throw new Error('请选择这个插件的新版本。'); setCandidate(result.value);
        }); }}>{busy ? '正在检查…' : '查看安装内容'}</button></> : <>
        <h3>{candidate.manifest.notara.title}<small>v{candidate.manifest.version}</small></h3><p>{candidate.manifest.notara.description}</p>
        <ul>{names(candidate).map(item => <li key={item.kind + item.title}><span>{item.title}</span><small>{item.kind}</small></li>)}</ul>
        {candidate.native ? <label className="sf-plugin-trust"><input type="checkbox" checked={trust} onChange={event => setTrust(event.target.checked)} />我信任此来源，允许它运行本机代码</label> : <p>工作台在隔离环境运行，保存笔记需你确认。</p>}
        {candidate.current && <p>当前版本 {candidate.current.version}，已有课堂保留使用中的版本。</p>}
        <div className="sf-plugin-actions"><button className="sf-action" disabled={busy || candidate.native && !trust} onClick={() => { void action(async () => {
          const result = await ctx.remote.studyforgePlugins.installPackage({ candidateId: candidate.candidateId, expectedVersion: candidate.current?.revision ?? 0, trustNative: trust });
          if (!result.ok) throw new Error('安装未完成，请重新检查。更新包需要使用新的版本号，原版本会保留。');
          setSelected(result.value.ref); setInstalling(false); setNotice(result.value.state === 'enabled' ? '已安装并启用' : STATUS[result.value.state]);
        }); }}>{busy ? '正在安装…' : candidate.current ? '确认更新' : '确认安装'}</button><button className="sf-quiet" disabled={busy} onClick={() => setCandidate(undefined)}>重新选择</button></div>
      </>}{notice && <p role="status">{notice}</p>}
    </section></div>}
  </main>;
}
export function PluginIcon(): React.JSX.Element { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 4h5V2a2 2 0 0 1 4 0v2h5v5h-2a2 2 0 0 0 0 4h2v5h-5v-2a2 2 0 0 0-4 0v2H3v-5h2a2 2 0 0 0 0-4H3z" /></svg>; }

export function registerPlugins(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.plugins', priority: -20 }, () => <PluginManagerPage ctx={ctx} />)));
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'studyforge.plugins', order: 60, label: '插件' }, PluginIcon)));
}
