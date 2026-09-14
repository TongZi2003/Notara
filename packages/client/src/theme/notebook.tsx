import type { Context } from '@deepseek-ai/cordis';
import { PRODUCT_MARK } from '../shell/brand.ts';
import type {} from '@deepseek-ai/dsh-client-ui-theme/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { MaterialNavigation } from '../materials/material-navigation.ts';
import { alignNotebook } from './align-notebook.ts';
import './typography.css';
import './notebook.css';
import './modern.css';
import { APPEARANCE_KEY as KEY, DEFAULT_APPEARANCE as DEFAULTS, readAppearance, type Appearance } from './appearance.ts';

const APPEARANCE = 'studyforge.appearance' as MainPanelId;
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
  '--dsw-specific-bubble': 'transparent', '--dsw-font-family': 'var(--sf-ui-font)',
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
const MODERN: Record<string, string> = {
  '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-layer-1': '#ffffff', '--dsw-alias-bg-layer-2': '#f7f8fa', '--dsw-alias-bg-layer-3': '#f0f1f4', '--dsw-alias-bg-module-platform': '#f7f8fa',
  '--dsw-alias-label-primary': '#24262b', '--dsw-alias-label-secondary': '#626872', '--dsw-alias-label-tertiary': '#737984', '--dsw-alias-label-caption': '#737984', '--dsw-alias-label-primary-bluish': '#24262b', '--dsw-alias-label-primary-inverted': '#ffffff',
  '--dsw-alias-border-l1': '#eceef1', '--dsw-alias-border-l2': '#dfe3e8', '--dsw-alias-border-l3': '#c6cbd3', '--dsw-alias-border-l4': '#a1a8b3',
  '--dsw-alias-brand-primary': '#24262b', '--dsw-alias-brand-text': '#24262b', '--dsw-alias-link': '#3569b7', '--dsw-alias-state-business-primary': '#3569b7', '--dsw-alias-state-error-primary': '#b83b3b', '--dsw-alias-state-success-primary': '#34775a',
  '--dsw-alias-button-primary-fill': '#24262b', '--dsw-alias-button-primary-hover': '#41454e', '--dsw-alias-button-contrast-fill': '#24262b', '--dsw-alias-button-elevated-fill': '#ffffff',
  '--dsw-alias-interactive-bg-hover': '#f4f5f7', '--dsw-alias-interactive-bg-active': '#ebedf1', '--dsw-alias-markdown-code-block': '#f7f8fa', '--dsw-alias-markdown-inline-code': '#f0f1f4',
  '--dsw-specific-bubble': '#f5f6f8', '--dsw-font-family': 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif', '--dsw-specific-sidebar-fill': '#f7f8fa', '--dsw-specific-sidebar-nav-item-active': '#ebedf1', '--dsw-specific-sidebar-nav-item-hover': '#f0f1f4', '--dsw-specific-input-major': '#ffffff', '--dsw-specific-menu': '#ffffff',
};
const MODERN_DARK: Record<string, string> = { '#ffffff': '#202226', '#f7f8fa': '#191b1f', '#f0f1f4': '#2c2f35', '#24262b': '#eceef2', '#626872': '#b0b6c0', '#737984': '#a0a7b2', '#eceef1': '#30343b', '#dfe3e8': '#3b414b', '#c6cbd3': '#555d6a', '#a1a8b3': '#7f8998', '#3569b7': '#8cb4f3', '#b83b3b': '#f09b9b', '#34775a': '#87c4a2', '#41454e': '#d2d7e0', '#f4f5f7': '#2c2f35', '#ebedf1': '#343842', '#f5f6f8': '#2a2d33' };
const MODERN_TOKENS: ThemeTokenOverrides = Object.fromEntries(Object.entries(MODERN).map(([name, light]) => [name, { light, dark: MODERN_DARK[light] ?? light }]));

/** Theme state is browser-local appearance only; no course/fact/model writes. */
export function registerNotebook(ctx: Context, navigation: MaterialNavigation): void {
  let current = storedAppearance();
  let removeTokens: (() => void) | undefined;
  let appliedTone: string | undefined;
  let returnPanel: MainPanelId | null = null;
  let returnMaterial: unknown;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const get = (): Appearance => current;
  const oldAttributes = new Map(['data-sf-notebook', 'data-sf-style', 'data-sf-scheme', 'data-sf-size', 'data-sf-face', 'data-sf-paper', 'data-sf-tone', 'data-sf-table'].map(name => [name, document.body.getAttribute(name)]));
  function apply(): void {
    document.body.dataset.sfNotebook = 'on';
    for (const key of ['style', 'scheme', 'size', 'face', 'paper', 'tone', 'table'] as const) document.body.setAttribute('data-sf-' + key, current[key]);
    const palette = current.style + ':' + current.tone;
    if (removeTokens && appliedTone !== palette) { removeTokens(); removeTokens = undefined; }
    if (!removeTokens) {
      const tokens = current.style === 'modern' ? MODERN_TOKENS : current.tone === 'white' ? WHITE_TOKENS : TOKENS;
      removeTokens = ctx.theme.overrideTokens('@studyforge/notebook', tokens);
      appliedTone = palette;
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

  function Settings({ embedded = false }: { embedded?: boolean } = {}): React.JSX.Element {
    const state = useSyncExternalStore(subscribe, get);
    return <main className="sf-notebook-settings sf-page" data-testid="notebook-appearance">
      {!embedded && <header><button className="sf-quiet" data-testid="notebook-back" onClick={() => { if (returnPanel === 'studyforge.materials') navigation.restore(returnMaterial); ctx.layout.selectPanel(returnPanel); }}>← {returnPanel ? '返回' : '返回课堂'}</button><span>外观</span></header>}
      <div className="sf-notebook-settings-body"><h1>外观</h1>
        <div className="sf-theme-choices" role="radiogroup" aria-label="界面主题" data-testid="notebook-style">
          {(['modern', 'notebook'] as const).map(style => <button key={style} type="button" role="radio" aria-checked={state.style === style} data-testid={`theme-${style}`} onClick={() => update({ style })}>
            <span className={`sf-theme-sample sf-theme-sample-${style}`} aria-hidden="true"><i /><span><b /><em /><em /></span></span>
            <strong>{style === 'modern' ? '现代简约' : '手写手帐'}</strong><small>{style === 'modern' ? '白色 · 清晰 · 圆角' : '纸张 · 字迹 · 贴纸'}</small>
          </button>)}
        </div>
        <label>正文字号<select data-testid="notebook-size" value={state.size} onChange={event => update({ size: event.target.value as Appearance['size'] })}><option value="s">小</option><option value="m">中</option><option value="l">大</option></select></label>
        {state.style === 'notebook' && <div className="sf-paper-options">
        <label>纸色<select data-testid="notebook-tone" value={state.tone} onChange={event => update({ tone: event.target.value as Appearance['tone'] })}><option value="yellow">暖色纸张</option><option value="white">白色纸张</option></select></label>
        <label>字迹<select data-testid="notebook-scheme" value={state.scheme} onChange={event => update({ scheme: event.target.value as Appearance['scheme'] })}>
          <option value="jia">甲 · 钢笔行楷</option><option value="yi">乙 · 毛笔楷书</option><option value="bing">丙 · 文楷</option><option value="ding">丁 · 老师用印刷体</option>
        </select></label>
        <label>纸张<select data-testid="notebook-paper" value={state.paper} onChange={event => update({ paper: event.target.value as Appearance['paper'] })}><option value="hengxian">横线纸</option><option value="fangge">方格纸</option></select></label>
        <label>表格字迹<select data-testid="notebook-table-font" value={state.table} onChange={event => update({ table: event.target.value as Appearance['table'] })}><option value="follow">跟随当前字迹</option><option value="print">印刷体</option></select></label>
        <label>题面<select data-testid="notebook-face" value={state.face} onChange={event => update({ face: event.target.value as Appearance['face'] })}><option value="print">剪贴印刷</option><option value="hand">手抄</option></select></label>
        </div>}
        <div className="sf-notebook-specimen" data-testid="notebook-specimen"><p><span>师</span>先想想，这一步为什么能这样做？</p><p className="sf-notebook-student"><span>我</span>我想先试着把理由写下来。</p><p className="sf-notebook-red">先看定义域，再往下写。</p></div>
      </div>
    </main>;
  }
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'studyforge.appearance', label: '外观', order: 30 }, () => <Settings embedded />)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -10 }, ({ size }: PropsRuntime<'sidebar.brand.mark'>) => <span className="sf-notebook-seal" style={{ width: size, height: size }} aria-hidden="true">{PRODUCT_MARK}</span>)));
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

const ROUTES = { home: 'studyforge.home', courses: 'studyforge.courses', materials: 'studyforge.materials', cards: 'studyforge.cards', sets: 'studyforge.sets', memory: 'studyforge.memory', calendar: 'studyforge.calendar', appearance: 'studyforge.appearance', creator: 'studyforge.creator', classroom: null } as const;
function readRoute(hash: string): MainPanelId | null | undefined {
  const key = hash.replace(/^#studyforge\//, '');
  return hash.startsWith('#studyforge/') && Object.hasOwn(ROUTES, key) ? ROUTES[key as keyof typeof ROUTES] as MainPanelId | null : undefined;
}
function routeFor(panel: MainPanelId | null): string | null {
  const found = Object.entries(ROUTES).find(([, value]) => value === panel);
  return found ? '#studyforge/' + found[0] : null;
}
