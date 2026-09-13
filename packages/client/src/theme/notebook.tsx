import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-theme/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { MaterialNavigation } from '../materials/material-navigation.ts';
import { alignNotebook } from './align-notebook.ts';
import './notebook.css';

const KEY = 'studyforge.notebook.appearance';
const APPEARANCE = 'studyforge.appearance' as MainPanelId;
const DEFAULTS = { enabled: true, scheme: 'jia', size: 'm', face: 'print', paper: 'hengxian', tone: 'yellow', table: 'follow' } as const;
type Appearance = { enabled: boolean; scheme: 'jia' | 'yi' | 'bing' | 'ding'; size: 's' | 'm' | 'l'; face: 'print' | 'hand'; paper: 'hengxian' | 'fangge'; tone: 'yellow' | 'white'; table: 'follow' | 'print' };
const OPTIONS = { scheme: ['jia', 'yi', 'bing', 'ding'], size: ['s', 'm', 'l'], face: ['print', 'hand'], paper: ['hengxian', 'fangge'], tone: ['yellow', 'white'], table: ['follow', 'print'] } as const;
function readAppearance(value: unknown): Appearance {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Appearance = { ...DEFAULTS };
  if (typeof raw.enabled === 'boolean') result.enabled = raw.enabled;
  for (const key of ['scheme', 'size', 'face', 'paper', 'tone', 'table'] as const) {
    if ((OPTIONS[key] as readonly unknown[]).includes(raw[key])) Object.assign(result, { [key]: raw[key] });
  }
  return result;
}
function storedAppearance(): Appearance {
  try { return readAppearance(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return { ...DEFAULTS }; }
}

/** B@3831987 notebook palette through the native reversible token-layer API. */
const LIGHT: Record<string, string> = {
  '--dsw-alias-bg-base': '#f6f1e3', '--dsw-alias-bg-layer-1': '#fdfaf1', '--dsw-alias-bg-layer-2': '#efe7d2',
  '--dsw-alias-bg-layer-3': '#e9e2cf', '--dsw-alias-bg-module-platform': '#efe7d2',
  '--dsw-alias-label-primary': '#3a3531', '--dsw-alias-label-secondary': '#6f6a5f',
  '--dsw-alias-label-tertiary': '#756e61', '--dsw-alias-label-caption': '#8a806e',
  '--dsw-alias-label-primary-bluish': '#26437c', '--dsw-alias-label-primary-inverted': '#fdfaf1',
  '--dsw-alias-border-l1': '#e7e0cd', '--dsw-alias-border-l2': '#d9d2bd', '--dsw-alias-border-l3': '#b9b19c', '--dsw-alias-border-l4': '#a9a28b',
  '--dsw-alias-brand-primary': '#26437c', '--dsw-alias-brand-text': '#26437c', '--dsw-alias-link': '#26437c',
  '--dsw-alias-state-business-primary': '#26437c', '--dsw-alias-state-error-primary': '#c93a2e', '--dsw-alias-state-success-primary': '#3e7c59',
  '--dsw-alias-button-primary-fill': '#26437c', '--dsw-alias-button-primary-hover': '#3d5488',
  '--dsw-alias-button-contrast-fill': '#26437c', '--dsw-alias-button-elevated-fill': '#fdfaf1',
  '--dsw-alias-interactive-bg-hover': '#e9e2cf', '--dsw-alias-interactive-bg-active': '#e2d8bf',
  '--dsw-alias-markdown-code-block': '#eee7d6', '--dsw-alias-markdown-inline-code': '#ebe3cd',
  '--dsw-specific-bubble': 'transparent', '--dsw-font-family': '"Songti SC", "STSong", "Noto Serif SC", serif',
  '--dsw-specific-sidebar-fill': '#efe7d2', '--dsw-specific-sidebar-nav-item-active': '#e2d8bf', '--dsw-specific-sidebar-nav-item-hover': '#e9e2cf',
  '--dsw-specific-input-major': '#fdfaf1', '--dsw-specific-menu': '#fdfaf1',
};
const DARK: Record<string, string> = {
  '--dsw-alias-bg-base': '#28251f', '--dsw-alias-bg-layer-1': '#302d25', '--dsw-alias-bg-layer-2': '#373328',
  '--dsw-alias-bg-layer-3': '#211f1a', '--dsw-alias-bg-module-platform': '#211f1a',
  '--dsw-alias-label-primary': '#eee5d0', '--dsw-alias-label-secondary': '#c2b69c', '--dsw-alias-label-tertiary': '#b0a48a', '--dsw-alias-label-caption': '#a1947a',
  '--dsw-alias-label-primary-bluish': '#abc2f0', '--dsw-alias-label-primary-inverted': '#211f1a',
  '--dsw-alias-border-l1': '#443e32', '--dsw-alias-border-l2': '#514a3d', '--dsw-alias-border-l3': '#756a55', '--dsw-alias-border-l4': '#9b8b6c',
  '--dsw-alias-brand-primary': '#abc2f0', '--dsw-alias-brand-text': '#abc2f0', '--dsw-alias-link': '#abc2f0',
  '--dsw-alias-state-business-primary': '#abc2f0', '--dsw-alias-state-error-primary': '#ee947c', '--dsw-alias-state-success-primary': '#93be98',
  '--dsw-alias-button-primary-fill': '#abc2f0', '--dsw-alias-button-primary-hover': '#c4d4f3', '--dsw-alias-button-contrast-fill': '#abc2f0',
  '--dsw-alias-button-elevated-fill': '#302d25', '--dsw-alias-interactive-bg-hover': '#40392c', '--dsw-alias-interactive-bg-active': '#514734',
  '--dsw-alias-markdown-code-block': '#211f1a', '--dsw-alias-markdown-inline-code': '#40392c',
  '--dsw-specific-sidebar-fill': '#211f1a', '--dsw-specific-sidebar-nav-item-active': '#514734', '--dsw-specific-sidebar-nav-item-hover': '#40392c',
  '--dsw-specific-input-major': '#302d25', '--dsw-specific-menu': '#302d25',
};
const TOKENS: ThemeTokenOverrides = Object.fromEntries(Object.entries(LIGHT).map(([name, light]) => [name, { light, dark: DARK[name] ?? light }]));
// White paper changes surfaces through the same native token layer. Ink and
// the native dark palette keep their contrast; colored stickers keep their hue.
const WHITE_SURFACES: Record<string, string> = {
  '#f6f1e3': '#ffffff', '#fdfaf1': '#ffffff', '#efe7d2': '#ffffff', '#e9e2cf': '#f3f4f6',
  '#e2d8bf': '#e8ecf2', '#eee7d6': '#f2f4f7', '#ebe3cd': '#edf0f4',
  '#e7e0cd': '#edf0f3', '#d9d2bd': '#e0e4e9', '#b9b19c': '#b9c1cc', '#a9a28b': '#a1abb8',
};
const WHITE_TOKENS: ThemeTokenOverrides = Object.fromEntries(Object.entries(LIGHT).map(([name, light]) => [name, {
  light: WHITE_SURFACES[light] ?? light, dark: DARK[name] ?? light,
}]));

/** Theme state is browser-local appearance only; no course/fact/model writes. */
export function registerNotebook(ctx: Context, navigation: MaterialNavigation): void {
  let current = storedAppearance();
  let removeTokens: (() => void) | undefined;
  let appliedTone: Appearance['tone'] | undefined;
  let returnPanel: MainPanelId | null = null;
  let returnMaterial: unknown;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const get = (): Appearance => current;
  const oldAttributes = new Map(['data-sf-notebook', 'data-sf-scheme', 'data-sf-size', 'data-sf-face', 'data-sf-paper', 'data-sf-tone', 'data-sf-table'].map(name => [name, document.body.getAttribute(name)]));
  function apply(): void {
    document.body.dataset.sfNotebook = current.enabled ? 'on' : 'off';
    for (const key of ['scheme', 'size', 'face', 'paper', 'tone', 'table'] as const) document.body.setAttribute('data-sf-' + key, current[key]);
    if (removeTokens && (!current.enabled || appliedTone !== current.tone)) { removeTokens(); removeTokens = undefined; }
    if (current.enabled && !removeTokens) {
      removeTokens = ctx.theme.overrideTokens('@studyforge/notebook', current.tone === 'white' ? WHITE_TOKENS : TOKENS);
      appliedTone = current.tone;
    }
    for (const listener of listeners) listener();
  }
  function update(patch: Partial<Appearance>): void {
    current = readAppearance({ ...current, ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* Appearance remains usable with storage disabled. */ }
    apply();
  }
  const storage = (event: StorageEvent): void => { if (event.key === KEY || event.key === null) { current = storedAppearance(); apply(); } };
  window.addEventListener('storage', storage); apply();
  ctx.effect(alignNotebook);
  ctx.effect(() => () => {
    window.removeEventListener('storage', storage); removeTokens?.(); listeners.clear();
    for (const [name, value] of oldAttributes) { if (value === null) document.body.removeAttribute(name); else document.body.setAttribute(name, value); }
  });

  function Footer({ wide, usePanelInfo }: PropsRuntime<'sidebar.footer.action'>): React.JSX.Element {
    const state = useSyncExternalStore(subscribe, get);
    const panel = usePanelInfo(value => value.activePanelId);
    return <div className="sf-notebook-controls" data-wide={wide}>
      <button type="button" title="手写笔记本" aria-pressed={state.enabled} data-testid="notebook-toggle" onClick={() => update({ enabled: !state.enabled })}>{wide ? '手写' : '笔'}</button>
      <button type="button" title="字迹与纸张" data-testid="notebook-settings" onClick={() => { if (panel !== APPEARANCE) { returnPanel = panel; returnMaterial = navigation.snapshot(); } ctx.layout.selectPanel(APPEARANCE); }}>{wide ? '字迹…' : '纸'}</button>
      {wide && <div className="sf-paper-swatches"><span>纸</span>{(['hengxian', 'fangge'] as const).map(paper => <button key={paper} type="button" className={'sf-paper-' + paper}
        aria-label={paper === 'hengxian' ? '横线纸' : '方格纸'} aria-pressed={state.paper === paper} onClick={() => update({ paper })} />)}</div>}
    </div>;
  }
  function Settings(): React.JSX.Element {
    const state = useSyncExternalStore(subscribe, get);
    return <main className="sf-notebook-settings sf-page" data-testid="notebook-appearance">
      <header><button className="sf-quiet" data-testid="notebook-back" onClick={() => { if (returnPanel === 'studyforge.materials') navigation.restore(returnMaterial); ctx.layout.selectPanel(returnPanel); }}>← {returnPanel ? '返回' : '返回课堂'}</button><span>本子的样子</span></header>
      <div className="sf-notebook-settings-body"><h1>这本本子的字迹</h1><p className="sf-note">只改变纸面，不改变本子里的内容。</p>
        <label className="sf-notebook-check"><input type="checkbox" checked={state.enabled} onChange={event => update({ enabled: event.target.checked })} />使用手写笔记本</label>
        <label>主题<select data-testid="notebook-tone" value={state.tone} onChange={event => update({ tone: event.target.value as Appearance['tone'] })}><option value="yellow">黄色主题</option><option value="white">白色主题</option></select></label>
        <label>字迹<select data-testid="notebook-scheme" value={state.scheme} onChange={event => update({ scheme: event.target.value as Appearance['scheme'] })}>
          <option value="jia">甲 · 钢笔行楷</option><option value="yi">乙 · 毛笔楷书</option><option value="bing">丙 · 文楷</option><option value="ding">丁 · 老师用印刷体</option>
        </select></label>
        <label>字号<select data-testid="notebook-size" value={state.size} onChange={event => update({ size: event.target.value as Appearance['size'] })}><option value="s">小</option><option value="m">中</option><option value="l">大</option></select></label>
        <label>纸张<select data-testid="notebook-paper" value={state.paper} onChange={event => update({ paper: event.target.value as Appearance['paper'] })}><option value="hengxian">横线纸</option><option value="fangge">方格纸</option></select></label>
        <label>表格字迹<select data-testid="notebook-table-font" value={state.table} onChange={event => update({ table: event.target.value as Appearance['table'] })}><option value="follow">跟随当前字迹</option><option value="print">印刷体</option></select></label>
        <label>题面<select data-testid="notebook-face" value={state.face} onChange={event => update({ face: event.target.value as Appearance['face'] })}><option value="print">剪贴印刷</option><option value="hand">手抄</option></select></label>
        <div className="sf-notebook-specimen" data-testid="notebook-specimen"><p><span>师</span>先想想，这一步为什么能这样做？</p><p className="sf-notebook-student"><span>我</span>我想先试着把理由写下来。</p><p className="sf-notebook-red">先看定义域，再往下写。</p></div>
      </div>
    </main>;
  }
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'studyforge.notebook', order: 5 }, Footer)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -10 }, ({ size }: PropsRuntime<'sidebar.brand.mark'>) => <span className="sf-notebook-seal" style={{ width: size, height: size }} aria-hidden="true">学</span>)));
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -10 }, () => <span className="sf-notebook-welcome">今天想学什么？</span>)));
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: APPEARANCE, priority: 0 }, Settings)));
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'studyforge.notebook.routes' }, RouteBridge)));

  /** The native layout remains the route owner; the hash makes its pages addressable. */
  function RouteBridge({ usePanelInfo, useSessions }: PropsRuntime<'shell.overlay'>): null {
    const panel = usePanelInfo(value => value.activePanelId);
    const sessionId = useSessions(value => value.current);
    const initial = useRef(true);
    const applying = useRef<string | null>(null);
    const panelRef = useRef(panel); panelRef.current = panel;
    const previousPanel = useRef(panel);
    useEffect(() => {
      const navigate = (): void => {
        const target = readRoute(location.hash); if (target === undefined) return;
        applying.current = target === panelRef.current ? null : routeFor(target);
        if (target === APPEARANCE) {
          const saved = history.state?.studyforgeNotebookReturn;
          returnPanel = typeof saved === 'string' && routeFor(saved as MainPanelId) && saved !== APPEARANCE ? saved as MainPanelId : null;
          returnMaterial = history.state?.studyforgeNotebookReturnMaterial;
        }
        if (target === 'studyforge.materials') navigation.restore(history.state?.studyforgeNotebookMaterial);
        const priorSession = history.state?.studyforgeNotebookSession;
        if (target === null && typeof priorSession === 'string') {
          const known = ctx.sessions.list.getSnapshot().ids.find(id => id === priorSession);
          if (known) ctx.sessions.open(known);
        }
        ctx.layout.selectPanel(target);
      };
      window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate);
      const unsubscribe = navigation.subscribe(() => {
        if (panelRef.current === 'studyforge.materials' && location.hash === '#studyforge/materials') {
          history.replaceState({ ...history.state, studyforgeNotebookMaterial: navigation.snapshot() }, '');
        }
      });
      if (!location.hash) history.replaceState(history.state, '', location.pathname + location.search + '#studyforge/home');
      if (readRoute(location.hash) !== undefined) navigate();
      return () => { unsubscribe(); window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate); };
    }, []);
    useEffect(() => {
      const route = routeFor(panel); if (route === null) return;
      if (previousPanel.current === 'studyforge.materials' && panel !== previousPanel.current) navigation.restore(undefined);
      previousPanel.current = panel;
      const historyState = { ...history.state, studyforgeNotebookSession: sessionId,
        studyforgeNotebookReturn: panel === APPEARANCE ? returnPanel : undefined,
        studyforgeNotebookReturnMaterial: panel === APPEARANCE ? returnMaterial : undefined,
        studyforgeNotebookMaterial: panel === 'studyforge.materials' ? navigation.snapshot() : undefined };
      if (initial.current) {
        initial.current = false;
        if (readRoute(location.hash) !== undefined) return;
        history.replaceState(historyState, '', location.pathname + location.search + route); return;
      }
      if (applying.current) {
        if (applying.current === route) applying.current = null;
        return;
      }
      if (location.hash !== route || (panel === null && history.state?.studyforgeNotebookSession !== sessionId)) history.pushState(historyState, '', location.pathname + location.search + route);
    }, [panel, sessionId]);
    return null;
  }
}

const ROUTES = { home: 'studyforge.home', courses: 'studyforge.courses', materials: 'studyforge.materials', cards: 'studyforge.cards', sets: 'studyforge.sets', memory: 'studyforge.memory', calendar: 'studyforge.calendar', appearance: 'studyforge.appearance', classroom: null } as const;
function readRoute(hash: string): MainPanelId | null | undefined {
  const key = hash.replace(/^#studyforge\//, '');
  return hash.startsWith('#studyforge/') && Object.hasOwn(ROUTES, key) ? ROUTES[key as keyof typeof ROUTES] as MainPanelId | null : undefined;
}
function routeFor(panel: MainPanelId | null): string | null {
  const found = Object.entries(ROUTES).find(([, value]) => value === panel);
  return found ? '#studyforge/' + found[0] : null;
}
