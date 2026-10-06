import { createVaultClient, visibleInterval } from './remote-client.js';
import { directoryLessons, selectedVaultDirectory } from './shell-client.js';
import { PLAN_VIEWS, RAIL_SECTIONS, VAULT_VIEWS, boardCollapse, folderLessons, lessonGroups, railSectionOf } from './rail-data.js';
import { createPanelSearch } from './panel-search-client.js';
import { EMPTY_STATES } from './empty-state-client.js';
import { routeRailSummary } from './routes-client.js';
import { createFileTree } from './file-tree-client.js';
import { currentSessionId, mainViewSettled } from './session-current.js';
import { createSessionDeletionUI } from './session-deletion-client.js';
import { createSessionActionsUI } from './session-actions-client.js';
import { createSessionGroupsUI } from './session-groups-client.js';
import { createShutdownUI } from './shutdown-client.js';

/** Below this width the native sidebar folds itself and an opened panel covers the content. */
const NARROW = 1024;
const VAULT_EVENTS = ['notara-vault-changed', 'notara-vault-files-changed'];

/**
 * The sidebar as a 56px icon rail plus the panel of the current section. The
 * native sidebar is exactly the rail's width when folded, so folding leaves the
 * rail. Panels talk to the main area only through `navigation`.
 */
export function createVaultRail(React, { navigation, Icon, IconButton, Menu, NativeMenu, Dialog, STYLE, SkillsPanel = null, sections = RAIL_SECTIONS }) {
  const h = React.createElement, { useState, useEffect, useRef, useMemo, useSyncExternalStore } = React;
  const useNav = () => useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  const useSessions = ctx => useSyncExternalStore(fn => ctx.sessions.list.subscribe(fn), () => ctx.sessions.list.getSnapshot());
  const useSpaces = ctx => useSyncExternalStore(fn => ctx.workspaces.list.subscribe(fn), () => ctx.workspaces.list.getSnapshot());
  const Tree = createFileTree(React, { STYLE });
  const { DeleteSessionDialog } = createSessionDeletionUI(React, { Dialog, IconButton });
  const { useSessionActions } = createSessionActionsUI(React, { Dialog, IconButton, Icon, NativeMenu });
  const { useSessionGroups } = createSessionGroupsUI(React, { Dialog, IconButton, Icon, NativeMenu });
  const { useVaultShutdown } = createShutdownUI(React, { Dialog, IconButton });
  const { usePanelSearch, SearchButton, SearchInput } = createPanelSearch(React, { IconButton });
  const fmtDay = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });

  function waitForMainSessionChange(ctx, sessionId, timeoutMs = 12_000) {
    const list = ctx.sessions.list;
    return new Promise(resolve => {
      let stop = () => {};
      const finish = value => { clearTimeout(timer); stop(); resolve(value); };
      const check = () => {
        const snapshot = list.getSnapshot();
        if (mainViewSettled(snapshot) && currentSessionId(snapshot) !== sessionId) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      stop = list.subscribe(check);
      check();
    });
  }

  // The directory dialog outlives the Home panel (it opens from the main area
  // too, even with the panel folded); the panel's button reads the same state.
  let picker = { open: false, switching: false, error: '' };
  const pickerListeners = new Set();
  const setPicker = patch => { picker = { ...picker, ...patch }; for (const fn of pickerListeners) fn(); };
  const usePicker = () => useSyncExternalStore(fn => { pickerListeners.add(fn); return () => pickerListeners.delete(fn); }, () => picker);

  function DirectoryPicker({ ctx }) {
    const nav = useNav(), sessions = useSessions(ctx), spaces = useSpaces(ctx), state = usePicker();
    const directory = selectedVaultDirectory(spaces, sessions, nav.directoryId, nav);
    const [directoryPath, setDirectoryPath] = useState(''), [directoryListing, setDirectoryListing] = useState(null), [scanning, setScanning] = useState(false);
    const pickerAttempt = useRef(0), busyRef = useRef(false), seen = useRef(nav.pickerRequest);
    // Always mounted, so the directory is remembered whether or not the Home panel is open.
    useEffect(() => { if (directory) navigation.rememberDirectory(directory.workspaceId); }, [directory?.workspaceId]);
    useEffect(() => { if (nav.pickerRequest !== seen.current) { seen.current = nav.pickerRequest; setPicker({ open: true, error: '' }); } }, [nav.pickerRequest]);
    useEffect(() => () => { pickerAttempt.current++; }, []);
    const closePicker = () => { pickerAttempt.current++; setPicker({ open: false, error: '' }); setScanning(false); };
    const pickDirectory = async workspaceId => {
      pickerAttempt.current++; setScanning(false); setPicker({ open: false, error: '' });
      if (workspaceId === directory?.workspaceId && directory.sessionIds?.includes(currentSessionId(sessions))) return;
      setPicker({ switching: true });
      try { await ctx.uiWorkspace.openWorkspace(workspaceId, sessionId => navigation.adoptHome(sessionId, workspaceId)); }
      // The picker opens again with the reason, wherever it was opened from and whether or not the panel is open.
      catch { setPicker({ open: true, error: '目录没有打开，请重新选择。' }); }
      finally { setPicker({ switching: false }); }
    };
    const addDirectory = async path => {
      if (!path.trim() || busyRef.current) return;
      const attempt = ++pickerAttempt.current; busyRef.current = true; setPicker({ switching: true, error: '' });
      try {
        const workspace = await ctx.workspaces.create({ path: path.trim() });
        if (attempt !== pickerAttempt.current) return;
        await pickDirectory(workspace.workspaceId); setDirectoryPath('');
      } catch { if (attempt === pickerAttempt.current) setPicker({ error: '无法打开这个目录，请检查路径是否存在并且可以访问。' }); }
      finally { busyRef.current = false; setPicker({ switching: false }); }
    };
    const browseDirectory = async path => {
      const attempt = ++pickerAttempt.current; setPicker({ error: '' }); setScanning(true);
      try {
        const listing = await ctx.uiWorkspace.listDirectory(path || directoryPath.trim() || directory?.path);
        if (attempt === pickerAttempt.current) { setDirectoryListing(listing); setDirectoryPath(listing.path); }
      } catch (error) {
        if (attempt !== pickerAttempt.current) return;
        // Native-only hosts refuse browse; use their system picker. Actual path
        // failures keep the typed path and never silently choose a different one.
        if (error?.rpcError?.code === 'directory-picker/unavailable') {
          try { const picked = await ctx.uiWorkspace.pickDirectory(); if (picked && attempt === pickerAttempt.current) setDirectoryPath(picked); }
          catch { if (attempt === pickerAttempt.current) setPicker({ error: '目录选择器暂不可用，可以直接填写目录路径。' }); }
        } else if (attempt === pickerAttempt.current) setPicker({ error: '无法浏览此目录，请检查路径，或直接打开目录。' });
      } finally { if (attempt === pickerAttempt.current) setScanning(false); }
    };
    const switching = state.switching, directoryError = state.error;
    return state.open && h(Dialog, { title: '选择学习目录', onClose: closePicker },
      h('div', { className: 'nv-directory-options' }, spaces.items.map(item => h('button', { key: item.workspaceId, type: 'button', 'aria-pressed': directory?.workspaceId === item.workspaceId, disabled: switching, onClick: () => pickDirectory(item.workspaceId) },
        h(Icon, { name: 'folder' }), h('span', null, h('strong', null, item.title), h('small', null, item.path)), directory?.workspaceId === item.workspaceId && h('span', { 'aria-hidden': true }, '✓')))),
      h('form', { className: 'nv-directory-form', onSubmit: event => { event.preventDefault(); void addDirectory(directoryPath); } },
        h('label', null, '打开其他目录', h('input', { 'aria-label': '目录路径', value: directoryPath, placeholder: '粘贴文件夹的完整路径', disabled: switching, onChange: event => setDirectoryPath(event.target.value) })),
        h('div', { className: 'nv-directory-actions' }, h('button', { type: 'button', className: 'nv-quiet', disabled: switching || scanning, onClick: () => browseDirectory() }, scanning ? '正在读取…' : '浏览文件夹'), h('button', { type: 'submit', className: 'nv-quiet', disabled: switching || scanning || !directoryPath.trim() }, switching ? '正在打开…' : '打开目录')),
        directoryListing && h('div', { className: 'nv-directory-browser', 'aria-label': '目录浏览' },
          h('div', { className: 'nv-directory-browser-head' }, h('span', null, '当前目录'), h('button', { type: 'button', disabled: scanning || directoryListing.crumbs.length < 2, onClick: () => browseDirectory(directoryListing.crumbs.at(-2)?.path) }, '上一级')),
          directoryListing.entries.filter(entry => !entry.hidden).map(entry => h('button', { key: entry.path, type: 'button', disabled: scanning, onClick: () => browseDirectory(entry.path) }, h(Icon, { name: 'folder' }), entry.name)),
          !directoryListing.entries.some(entry => !entry.hidden) && h('p', null, '没有可见的子文件夹，可以直接打开当前目录。'),
          directoryListing.truncated && h('p', null, '此目录较大，未显示全部文件夹；可以直接填写完整路径。')),
        directoryError && h('p', { role: 'alert', className: 'nv-directory-error' }, directoryError)));
  }

  function HomePanel({ ctx, dismiss, renderSidebarSlot }) {
    const [manage, setManage] = useState(false);
    const nav = useNav(), sessions = useSessions(ctx), spaces = useSpaces(ctx), state = usePicker();
    const directory = selectedVaultDirectory(spaces, sessions, nav.directoryId, nav);
    const search = usePanelSearch(), lessons = directoryLessons(directory, spaces, sessions);
    const sessionActions = useSessionActions(ctx, navigation);
    const folderActions = useSessionGroups(ctx, directory?.workspaceId);
    const grouped = folderLessons(lessons, folderActions.data, search.query), groups = lessonGroups(grouped.ungrouped, new Date());
    const [collapsed, setCollapsed] = useState(new Set());
    const collapseKey = directory ? `notara-vault-folders:${directory.workspaceId}` : null;
    useEffect(() => {
      try { const saved = JSON.parse(collapseKey ? sessionStorage.getItem(collapseKey) ?? '[]' : '[]'); setCollapsed(new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : [])); }
      catch { setCollapsed(new Set()); }
    }, [collapseKey]);
    const toggleFolder = id => {
      if (search.query.trim()) return;
      setCollapsed(previous => {
        const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id);
        try { if (collapseKey) sessionStorage.setItem(collapseKey, JSON.stringify([...next])); } catch { /* folding still works if tab storage is full */ }
        return next;
      });
    };
    const [deleteTarget, setDeleteTarget] = useState(null), [deleteNotice, setDeleteNotice] = useState('');
    const open = row => { navigation.show('lesson'); ctx.uiWorkspace.openSession(row.id); dismiss(); };
    const start = () => { if (!directory) { navigation.requestDirectoryPicker(); return; } if (navigation.startLesson(ctx, directory.workspaceId)) dismiss(); };
    const requestDelete = async row => {
      setDeleteNotice('');
      if (currentSessionId(sessions) === row.id) {
        // The main conversation pane stays mounted while hidden. Prepare Home's
        // native blank Session and wait until its mainView retain replaces this
        // Session before asking the Host to inspect observation references.
        navigation.show('home');
        await navigation.prepareHome(ctx);
        if (!await waitForMainSessionChange(ctx, row.id)) {
          setDeleteNotice('首页输入框还没有切换好，请稍后再试删除。');
          return;
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      setDeleteTarget(row);
    };
    const sessionRow = row => h('div', { key: row.id, className: 'nv-session-row-wrap' },
      h('button', { type: 'button', className: 'nv-session-row',
        'aria-current': nav.section === 'lesson' && currentSessionId(sessions) === row.id ? 'page' : undefined,
        title: row.title || '未命名课堂', onClick: () => open(row) },
        h('i', { className: 'nv-session-dot', 'data-running': !!row.running }), h('span', null, row.title || '未命名课堂'),
        h('time', null, row.running ? '进行中' : fmtDay.format(new Date(row.updatedAt)))),
      h(sessionActions.SessionMenu, { session: row, disabled: !!sessionActions.busyId || folderActions.busy, onRename: sessionActions.rename, onArchive: sessionActions.archive,
        onDelete: row => { void requestDelete(row); }, onMove: folderActions.ready ? folderActions.move : undefined }));
    return h(React.Fragment, null,
      h('div', { className: 'nv-panel-head' }, h('h2', null, '课堂'), h(SearchButton, { search }),
        h(IconButton, { icon: 'folder', label: '新建分组', disabled: !folderActions.ready || folderActions.busy, onClick: folderActions.create }),
        h(IconButton, { icon: 'more', label: '管理课堂', 'aria-haspopup': 'dialog', 'aria-expanded': manage, onClick: () => setManage(true) })),
      h(SearchInput, { search, label: '搜索课堂', placeholder: '按标题找课堂…' }),
      h('div', { className: 'nv-directory' },
        h('button', { type: 'button', className: 'nv-directory-button', 'aria-label': directory ? '选择目录，当前：' + directory.title : '选择学习目录', 'aria-haspopup': 'dialog', 'aria-expanded': state.open, disabled: state.switching || spaces.phase !== 'ready', title: directory?.path || '选择学习目录', onClick: () => navigation.requestDirectoryPicker() },
          h(Icon, { name: 'folder' }), h('span', null, state.switching ? '正在打开…' : directory?.title || '选择学习目录'), h('span', { className: 'nv-directory-chevron', 'aria-hidden': true }, '⌄'))),
      h('button', { type: 'button', className: 'nv-new-lesson', 'aria-label': '新的一课', disabled: state.switching || nav.resuming || spaces.phase !== 'ready' || sessions.phase !== 'ready' || (!!directory && !mainViewSettled(sessions)), onClick: start }, h(Icon, { name: 'plus' }), '新的一课'),
      deleteNotice && h('p', { role: 'status', className: 'nv-delete-status' }, deleteNotice),
      sessionActions.status,
      folderActions.status,
      h('div', { className: 'nv-panel-scroll' },
        grouped.folders.map(group => {
          const expanded = !!search.query.trim() || !collapsed.has(group.id);
          return h('section', { key: group.id, className: 'nv-lesson-folder', 'aria-label': `对话分组：${group.title}` },
            h('div', { className: 'nv-session-row-wrap' },
              h('button', { type: 'button', className: 'nv-session-row nv-folder-toggle', 'aria-label': `分组：${group.title}`, 'aria-expanded': expanded,
                onClick: () => toggleFolder(group.id) },
                h(Icon, { name: 'folder' }), h('span', null, group.title), h('small', null, group.rows.length), h('small', { 'aria-hidden': true }, expanded ? '⌄' : '›')),
              h(folderActions.FolderMenu, { group, disabled: folderActions.busy, onRename: folderActions.rename, onDissolve: folderActions.dissolve })),
            expanded && h('div', { className: 'nv-folder-lessons' }, group.rows.length ? group.rows.map(sessionRow) : h('p', { className: 'nv-panel-note' }, '暂无对话')));
        }),
        groups.length
          ? groups.map(group => h('section', { key: group.key, className: 'nv-panel-group', 'aria-label': group.label },
            h('h3', null, group.label),
            group.rows.map(sessionRow),
          ))
          : !grouped.folders.length && h('p', { className: 'nv-panel-note' }, search.query.trim() && lessons.length ? '没有找到这节课' : directory ? EMPTY_STATES.homeNoLessons.text : mainViewSettled(sessions) ? '选择目录后查看课堂' : '正在读取…')),
      manage && h(Dialog, { title: '管理课堂', onClose: () => setManage(false) },
        h('p', { className: 'nv-panel-note' }, '在课堂旁归档；在列表选项中显示已归档课堂后，可以取消归档。'),
        h('div', { className: 'nv-session-manager' }, renderSidebarSlot('sidebar.workspaces', { wide: true }))),
      sessionActions.overlay,
      folderActions.overlay,
      deleteTarget && h(DeleteSessionDialog, { ctx, session: deleteTarget, onClose: () => setDeleteTarget(null), onDeleted: result => {
        setDeleteTarget(null);
        if (result?.cleanupPending) setDeleteNotice('课堂记录已移除，少量磁盘清理会在下次启动时重试。');
      } }));
  }

  function ViewTabs({ label, views, current, onPick }) {
    return h('div', { className: 'nv-panel-views', role: 'tablist', 'aria-label': label, 'aria-orientation': 'vertical' },
      views.map(([id, name]) => h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': current === id, onClick: () => onPick(id) }, name)));
  }

  function RouteList({ ctx, dismiss }) {
    const nav = useNav(), sessions = useSessions(ctx);
    const vault = useMemo(() => createVaultClient(ctx, currentSessionId(sessions)), [ctx, currentSessionId(sessions)]);
    const [data, setData] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      let live = true;
      const read = async () => {
        try { const result = await vault.routes({}); if (!live) return; if (!result?.ok) throw new Error('read'); setData(result.value); setError(''); }
        catch { if (live) setError('路线暂时读不出来。'); }
      };
      void read(); const stop = visibleInterval(read, 15000); window.addEventListener('notara-vault-changed', read);
      return () => { live = false; stop(); window.removeEventListener('notara-vault-changed', read); };
    }, [vault]);
    // Highlight what the route page reported, never a guess of our own.
    const routes = data?.routes ?? [], current = nav.routePath;
    if (error) return h('p', { className: 'nv-panel-note', role: 'alert' }, error);
    if (!routes.length) return null;
    return h('section', { className: 'nv-panel-group', 'aria-label': '路线列表' }, h('h3', null, '学习路线'),
      routes.map(route => {
        const summary = routeRailSummary(route, data.nodes);
        return h('button', { key: route.path, type: 'button', className: 'nv-session-row', 'aria-current': current === route.path ? 'page' : undefined, onClick: () => { navigation.selectRoute(route.path); dismiss(); } },
          h('span', null, route.title || route.path), h('time', null, route.error ? '格式有误' : `${summary.logged}/${summary.total} 课`));
      }));
  }

  function PlanPanel({ ctx, dismiss }) {
    const nav = useNav();
    return h(React.Fragment, null,
      h('div', { className: 'nv-panel-head' }, h('h2', null, '计划')),
      h(ViewTabs, { label: '计划视图', views: PLAN_VIEWS, current: nav.plan, onPick: id => { navigation.show('plan', id); if (id !== 'routes') dismiss(); } }),
      nav.plan === 'routes' && h('div', { className: 'nv-panel-scroll' }, h(RouteList, { ctx, dismiss })));
  }

  function VaultPanel({ ctx, dismiss }) {
    const nav = useNav(), sessions = useSessions(ctx);
    const vault = useMemo(() => createVaultClient(ctx, currentSessionId(sessions)), [ctx, currentSessionId(sessions)]);
    const [tree, setTree] = useState(null), [error, setError] = useState(''), [menu, setMenu] = useState(null);
    // Search reads titles, text and paths; its results stand in for the tree until it closes.
    const search = usePanelSearch(), [hits, setHits] = useState(null), [searchError, setSearchError] = useState('');
    useEffect(() => {
      const query = search.query.trim();
      if (!query) { setHits(null); setSearchError(''); return undefined; }
      let live = true;
      const timer = setTimeout(async () => {
        try { const result = await vault.search({ query, limit: 50 }); if (!live) return; if (!result?.ok) throw new Error('search'); setHits(result.value); setSearchError(''); }
        catch { if (live) { setHits([]); setSearchError('搜索暂时不可用，请稍后再试。'); } }
      }, 200);
      return () => { live = false; clearTimeout(timer); };
    }, [vault, search.query]);
    useEffect(() => {
      let live = true; setTree(null);
      const read = async () => {
        try { const result = await vault.list({}); if (!live) return; if (!result?.ok) throw new Error('read'); setTree(result.value.tree); setError(''); }
        catch { if (live) setError('文件树暂时无法读取。'); }
      };
      void read(); const stop = visibleInterval(read, 15000);
      for (const name of VAULT_EVENTS) window.addEventListener(name, read);
      return () => { live = false; stop(); for (const name of VAULT_EVENTS) window.removeEventListener(name, read); };
    }, [vault]);
    useEffect(() => {
      if (!menu) return undefined;
      const close = event => { if (!event.target.closest?.('.nv-context-menu')) setMenu(null); };
      const key = event => { if (event.key === 'Escape') setMenu(null); };
      window.addEventListener('pointerdown', close); window.addEventListener('keydown', key);
      return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
    }, [menu]);
    // Every choice made in the panel folds it on a narrow screen, menus included.
    const run = command => { navigation.command('vault', 'files', command); dismiss(); };
    return h(React.Fragment, null,
      h('div', { className: 'nv-panel-head' }, h('h2', null, 'Vault'),
        h(Menu, { label: '新建', icon: 'plus', items: [{ label: '从模板新建', run: () => run({ type: 'create-page' }) }, { label: '新建代码文件', run: () => run({ type: 'create-code' }) }, { label: '导入媒体文件', run: () => run({ type: 'upload' }) }] }),
        h(SearchButton, { search })),
      h(SearchInput, { search, label: '搜索文件', placeholder: '搜索标题、内容或路径…' }),
      h(ViewTabs, { label: 'Vault 视图', views: VAULT_VIEWS, current: nav.section === 'vault' ? nav.vault : '', onPick: id => { navigation.show('vault', id); dismiss(); } }),
      search.query.trim() ? h('div', { className: 'nv-panel-scroll', role: 'group', 'aria-label': '搜索结果' },
        searchError ? h('p', { className: 'nv-panel-note', role: 'alert' }, searchError)
          : !hits ? h('p', { className: 'nv-panel-note' }, '正在搜索…')
            : !hits.length ? h('p', { className: 'nv-panel-note' }, '没有找到相关的文件')
              : hits.map(item => h('button', { key: item.path, type: 'button', className: 'nv-session-row', title: item.path, 'aria-current': nav.filePath === item.path ? 'page' : undefined, onClick: () => { navigation.show('vault', 'files', item.path); dismiss(); } }, h('span', null, item.path))))
      : h('div', { className: 'nv-panel-scroll', role: 'group', 'aria-label': '文件列表' },
        error ? h('p', { className: 'nv-panel-note', role: 'alert' }, error)
          : !tree ? h('p', { className: 'nv-panel-note' }, '正在读取…')
            : h(Tree, { node: tree, selected: nav.section === 'vault' && nav.vault === 'files' ? nav.filePath : '', onSelect: path => { navigation.show('vault', 'files', path); dismiss(); },
              onContext: (path, event) => setMenu({ path, x: event.clientX, y: event.clientY }) })),
      h('button', { type: 'button', className: 'nv-panel-foot', onClick: () => run({ type: 'trash-list' }) }, h(Icon, { name: 'trash' }), '回收站'),
      menu && h('div', { className: 'nv-context-menu', role: 'menu', style: { left: Math.min(menu.x, Math.max(8, window.innerWidth - 224)), top: Math.min(menu.y, Math.max(8, window.innerHeight - 200)) }, onContextMenu: event => event.preventDefault() },
        [['打开文件', () => { navigation.show('vault', 'files', menu.path); dismiss(); }], ['将整个文件带入对话', () => run({ type: 'bring', path: menu.path })],
          ['在图谱中查看', () => { navigation.show('vault', 'graph', menu.path); dismiss(); }], ['移到回收站', () => run({ type: 'trash', path: menu.path })]]
          .map(([label, act]) => h('button', { key: label, type: 'button', role: 'menuitem', onClick: () => { setMenu(null); act(); } }, label))));
  }

  function Sidebar({ ctx, collapsed, renderSidebarSlot }) {
    const shutdown = useVaultShutdown(ctx);
    const nav = useNav(), active = railSectionOf(nav.section);
    const dismiss = () => { if (window.innerWidth < NARROW && !collapsed) ctx.layout.toggleSidebar(); };
    // Folded, a press switches the main area; only the section already shown there
    // unfolds. An open lesson is highlighted under 首页 but is not Home itself.
    const choose = id => { if (collapsed && id === nav.section) { ctx.layout.toggleSidebar(); return; } navigation.show(id); ctx.layout.selectPanel(null); };
    // The board folds an open panel; only a fold the board made is undone when leaving it.
    const machine = useRef({ auto: false, pending: null }), seen = useRef(collapsed);
    useEffect(() => {
      const step = boardCollapse(machine.current, { type: 'board', focused: nav.boardFocus, collapsed, narrow: window.innerWidth < NARROW });
      machine.current = step.state; if (step.toggle) ctx.layout.toggleSidebar();
    }, [nav.boardFocus]);
    useEffect(() => {
      if (seen.current === collapsed) return; seen.current = collapsed;
      machine.current = boardCollapse(machine.current, { type: 'collapsed', collapsed }).state;
    }, [collapsed]);
    const Panel = active === 'home' ? HomePanel : active === 'plan' ? PlanPanel : active === 'vault' ? VaultPanel : active === 'skills' ? SkillsPanel : null;
    return h('aside', { className: 'nv-sidebar', 'data-collapsed': collapsed || undefined, 'aria-label': 'Notara 导航' },
      h('nav', { className: 'nv-rail', 'aria-label': '学习导航' },
        h(IconButton, { icon: 'sidebar', label: collapsed ? '展开面板' : '收起面板', onClick: () => ctx.layout.toggleSidebar() }),
        sections.map(section => h('button', { key: section.id, type: 'button', className: 'nv-rail-button', 'aria-label': section.label, title: section.label, 'aria-current': active === section.id ? 'page' : undefined, onClick: () => choose(section.id) }, h(Icon, { name: section.icon }))),
        h('div', { className: 'nv-rail-foot' }, renderSidebarSlot('sidebar.footer.action', { wide: false }), shutdown.button, renderSidebarSlot('sidebar.settings', { wide: false }))),
      !collapsed && Panel && h('div', { className: 'nv-panel', 'data-section': active }, h(Panel, { ctx, dismiss, renderSidebarSlot })),
      h(DirectoryPicker, { ctx }), shutdown.dialog);
  }
  return { Sidebar };
}
