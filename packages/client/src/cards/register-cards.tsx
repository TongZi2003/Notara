/**
 * P5 surface registration: one student page for the card library.
 *
 * The page is an ordinary keyed occupant of the native frame's `main` slot,
 * exactly like the other student pages, and its single stylesheet is installed
 * with the client's own lifetime. The entry point is exported so the client
 * root decides whether this library is its own page or a view inside another.
 */
import '../materials/original-pages.css';
import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { useEffect, useState } from 'react';
import { ProposalInbox } from '../proposals/ProposalInbox.tsx';
import { LearningRecords } from '../review/LearningRecords.tsx';
import { ReviewHandout } from '../review/ReviewHandout.tsx';
import { ReviewScreen } from '../review/ReviewScreen.tsx';
import { cardOpenRequest } from './CardOpenRequest.tsx';
import { CardBrowser } from './CardBrowser.tsx';

/** Registered `main` key and matching sidebar row id. */
export const CARDS_PAGE_ID = 'studyforge.cards';

const css = `
.sf-cards-page{box-sizing:border-box;height:100%;min-height:0;overflow:auto;background:#fdfaf1;color:#26437c;font-family:"Songti SC","Noto Serif SC",serif;padding:24px clamp(20px,4vw,48px) 64px}
.sf-cards-page-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:1px solid #d9d2bd;padding-bottom:14px;margin-bottom:18px;font-size:13px;letter-spacing:.08em}
.sf-cards{display:flex;flex-direction:column;gap:14px;max-width:78ch}
.sf-proposals{display:flex;flex-direction:column;gap:12px;max-width:78ch;border:1px solid #d9d2bd;border-radius:4px;background:#fffdf6;padding:16px 18px}
.sf-proposals h2{font-size:16px;font-weight:600;letter-spacing:.04em;margin:0}
.sf-proposal{display:flex;flex-direction:column;gap:10px;border-top:1px solid #eee7d6;padding-top:12px}
.sf-proposal-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.sf-proposal-head h3{font-size:15px;font-weight:600;margin:0}
.sf-inline-proposals{min-width:0;max-width:100%;display:grid;gap:10px}
.sf-inline-proposal{min-width:0;max-width:100%;overflow-wrap:anywhere;border:1px solid var(--sf-line,#d9d2bd);border-radius:4px;padding:12px 16px;background:var(--sf-paper,#fffdf6)}
.sf-inline-proposal>summary{cursor:pointer;display:flex;justify-content:space-between;gap:16px;align-items:baseline;color:var(--sf-ink,#26437c)}
.sf-inline-proposal>summary:before{content:'▸';font-size:12px}
.sf-inline-proposal[open]>summary:before{content:'▾'}
.sf-inline-proposal>summary>span:first-of-type{flex:1}
.sf-inline-proposal>.sf-proposal{margin-top:10px}
.sf-proposal-items{list-style:none;display:flex;flex-direction:column;gap:14px;margin:0;padding:0}
.sf-proposal-item{display:flex;flex-direction:column;gap:8px;border-left:2px solid #e7e0cd;padding-left:12px}
.sf-proposal-slip{display:flex;flex-direction:column;gap:8px}
.sf-proposal-item-head{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.sf-proposal-status{font-size:12px;color:#26437c}
.sf-proposal-content h4{margin:0 0 4px;font-size:14px;color:#26437c}
.sf-proposal-original{border-left:2px solid #cfc7ae;padding-left:10px;margin-top:6px}
.sf-proposal-lines{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.sf-proposal-actions,.sf-proposal-versions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sf-review{display:flex;flex-direction:column;gap:14px;max-width:70ch}
.sf-review-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;border-bottom:1px solid #d9d2bd;padding-bottom:10px}
.sf-review-head h2{font-size:18px;font-weight:500;margin:0;flex:1}
.sf-review-card{display:flex;flex-direction:column;gap:10px;border:1px solid #d9d2bd;border-radius:4px;background:#fffdf6;padding:18px}
.sf-review-card h3{margin:0;font-size:16px}
.sf-review-card h4{margin:10px 0 4px;font-size:13px;color:#26437c}
.sf-review-marks{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.sf-review-marks .sf-action{justify-content:space-between;width:100%;text-align:left}
.sf-action-quiet{background:transparent;color:#26437c;border-color:#cfc7ae}
.sf-action-quiet:hover{background:#f6f1e3}
.sf-review-result{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.sf-cards h2{font-size:clamp(20px,2vw,26px);font-weight:500;margin:0;line-height:1.4}
.sf-cards-head{display:flex;justify-content:space-between;align-items:center;gap:16px}
.sf-cards-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.sf-chip-row{display:flex;flex-wrap:wrap;gap:6px}
.sf-chip{border:1px solid #cfc7ae;border-radius:999px;background:transparent;color:#5a688a;cursor:pointer;font:inherit;font-size:12px;padding:4px 12px}
.sf-chip-on{border-color:#26437c;background:#26437c;color:#fdfaf1}
.sf-cards-search{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:inherit;font:inherit;font-size:13px;min-width:180px;padding:7px 10px}
.sf-card-list{list-style:none;margin:0;padding:0;border-top:1px solid #d9d2bd}
.sf-card-list ul{list-style:none;margin:0;padding:0}
.sf-card-row{display:flex;align-items:center;gap:10px;border-bottom:1px solid #eee7d6}
.sf-card-row-open{display:flex;flex:1;flex-direction:column;gap:3px;min-width:0;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;text-align:left;padding:11px 6px}
.sf-card-row-open:hover{background:#f6f1e3}
.sf-card-row-title{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-card-group-title{font-size:12px;font-weight:600;letter-spacing:.1em;color:#777d88;margin:16px 0 4px}
.sf-radial{display:flex;flex-direction:column;gap:10px}
.sf-radial-list{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0}
.sf-quiet{border:1px solid #cfc7ae;border-radius:3px;background:transparent;color:#26437c;cursor:pointer;font:inherit;font-size:12px;padding:5px 10px}
.sf-quiet:hover{background:#f6f1e3}
.sf-card-detail,.sf-card-editor,.sf-knowledge-editor{display:flex;flex-direction:column;gap:14px}
.sf-card-detail-head,.sf-card-editor-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.sf-card-detail-head h2{flex:1}
.sf-card-detail section,.sf-card-editor section{border-top:1px solid #d9d2bd;padding-top:12px}
.sf-card-detail h3,.sf-card-editor h4{margin:0 0 8px;font-size:12px;letter-spacing:.1em;color:#777d88}
.sf-card-detail h4{margin:10px 0 4px;font-size:13px;color:#26437c;letter-spacing:0}
.sf-card-detail ul,.sf-card-editor ul{list-style:none;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.sf-card-detail li{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px}
.sf-card-markdown{font-size:14px;line-height:1.85;color:#26437c;overflow-wrap:anywhere}
.sf-card-markdown pre{background:#f6f1e3;border-radius:3px;padding:10px;overflow:auto}
.sf-card-editor label,.sf-knowledge-editor label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#777d88}
.sf-card-editor input,.sf-card-editor textarea,.sf-card-editor select,.sf-knowledge-editor input,.sf-knowledge-editor textarea{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:#26437c;font:13px/1.7 inherit;padding:8px 10px}
.sf-write-frozen{border:0;margin:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:12px}
.sf-write-frozen:disabled{opacity:.75}
.sf-card-editor-buttons,.sf-card-editor-actions,.sf-conflict-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.sf-section-row{display:flex;flex-direction:column;gap:6px;border-bottom:1px dotted #e7e0cd;padding-bottom:10px;margin-bottom:10px}
.sf-notice{margin:0;border:1px solid #cfc7ae;border-radius:3px;background:#f6f1e3;color:#5a688a;font-size:12px;line-height:1.7;padding:8px 10px}
.sf-conflict-latest{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:10px 0;font-size:13px;color:#5a688a}
.sf-conflict-latest dt{color:#8a887c;font-size:12px}
.sf-conflict-latest dd{margin:0;overflow-wrap:anywhere}
.sf-action{display:inline-flex;align-items:center;gap:10px;border:1px solid #26437c;border-radius:3px;background:#26437c;color:#fdfaf1;cursor:pointer;font:inherit;font-size:14px;padding:10px 16px}
.sf-action:disabled{opacity:.55;cursor:default}
.sf-note{font-size:13px;color:#8a887c;margin:0}
.sf-change{display:flex;flex-direction:column;gap:6px;border-bottom:1px dotted #e7e0cd;padding-bottom:10px;margin-bottom:10px}
.sf-change-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;font-size:13px}
.sf-redline{display:flex;flex-direction:column;gap:10px}
.sf-redline-field{display:flex;flex-direction:column;gap:4px;border-top:0;padding-top:0}
.sf-redline-field h4{display:flex;gap:8px;align-items:baseline;margin:0;font-size:13px;color:#26437c}
.sf-redline-runs{display:flex;flex-direction:column;gap:6px;border-left:2px solid #e7e0cd;padding-left:10px}
.sf-redline-run{overflow-wrap:anywhere}
.sf-redline-old{color:#9c2f18}
.sf-redline-old del{text-decoration-color:#c0392b;text-decoration-thickness:2px}
.sf-redline-mark{display:inline-block;margin-bottom:2px;border-radius:2px;background:#e8efe4;color:#3c6b46;font-size:11px;letter-spacing:.08em;padding:1px 6px}
.sf-redline-new{border-left:2px solid #7d9a6a;padding-left:8px}
.sf-change-technical summary{cursor:pointer;font-size:12px;color:#777d88}
.sf-technical-diff{display:flex;flex-direction:column;gap:8px;margin-top:6px}
.sf-diff-facts{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:12px;color:#5a688a}
.sf-diff-facts dt{color:#8a887c}
.sf-diff-facts dd{margin:0;overflow-wrap:anywhere}
.sf-diff-text{display:flex;flex-direction:column;gap:4px;margin:6px 0}
.sf-diff-text-head{display:flex;gap:8px;align-items:center}
.sf-diff-text pre{max-height:220px;margin:0;border-radius:3px;background:#f6f1e3;font-size:12px;line-height:1.6;overflow:auto;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere}
.sf-cards-tabs{display:flex;gap:8px;margin-bottom:16px}
.sf-records{display:flex;flex-direction:column;gap:18px;max-width:78ch}
.sf-records-day h3{margin:0 0 6px;font-size:12px;letter-spacing:.1em;color:#777d88;font-weight:600}
.sf-records-day ul{list-style:none;display:flex;flex-direction:column;gap:10px;margin:0;padding:0}
.sf-record{display:flex;flex-direction:column;gap:4px;border-left:2px solid #e7e0cd;padding-left:12px}
.sf-record-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;font-size:14px}
.sf-record-mark{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:999px;background:#f6f1e3;color:#26437c;font-size:12px}
.sf-record-mark[data-mark="忘"]{background:#f7e2dd;color:#9c2f18}
.sf-record-mark[data-mark="牢"]{background:#e8efe4;color:#3c6b46}
.sf-record-note{margin:2px 0 0;font-size:13px;color:#5a688a;overflow-wrap:anywhere}
.sf-handout{display:flex;flex-direction:column;gap:10px;max-width:78ch}
.sf-handout ol{list-style:none;display:flex;flex-direction:column;gap:16px;margin:0;padding:0}
.sf-handout-card{display:flex;flex-direction:column;gap:8px;border:1px solid #d9d2bd;border-radius:4px;background:#fffdf6;padding:14px 16px}
.sf-handout-card h4{margin:8px 0 4px;font-size:13px;color:#26437c}
.sf-handout-card section{border-top:0;padding-top:0}
@media(max-width:760px){.sf-cards-page{padding:18px 16px 48px}.sf-cards-search{min-width:120px;flex:1}}
`;

/**
 * What the root has to supply: the card library never owns where a source
 * opens. "Back to the original" belongs to the lesson the student is in, and
 * the root passes the current session so an answer that arrives after a tab
 * switch can still open in the lesson it was asked from.
 */
export interface CardSurfacesOptions {
  readonly onSource?: (source: SourceAnchor, sessionId: string | undefined) => void;
}

/** Mount this client's card library as its own student page. */
export function registerCardSurfaces(ctx: Context, options: CardSurfacesOptions = {}): void {
  installStyles(ctx);
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: CARDS_PAGE_ID, priority: -10 },
    function CardsPage({ useSessions }: PropsRuntime<'main'>): React.JSX.Element {
      const sessionId = useSessions(state => state.current);
      // A confirmation writes a real card, so the library re-reads right after.
      const [refresh, setRefresh] = useState(0);
      const [studying, setStudying] = useState<string | undefined>(undefined);
      const [view, setView] = useState<'cards' | 'records' | 'handout'>('cards');
      const [focus, setFocus] = useState<{ target: string; seq: number } | undefined>(undefined);
      const openCard = (target: string): void => {
        setView('cards');
        setFocus(current => ({ target, seq: (current?.seq ?? 0) + 1 }));
      };
      // Another page can hand this library one card to open. The request may
      // have been made before this page mounted; the channel holds it until the
      // page is really here rather than inventing a second place to read cards.
      useEffect(() => cardOpenRequest.subscribe(target => { openCard(target); }), []);
      return <main className="sf-cards-page" data-testid={`studyforge-page-${CARDS_PAGE_ID}`}>
        <header className="sf-cards-page-head"><button className="sf-quiet" type="button" onClick={() => ctx.layout.selectPanel('studyforge.materials' as import('@deepseek-ai/dsh-client-ui-layout/client').MainPanelId)}>← 资料</button><span>卡片与笔记</span></header>
        {studying === undefined
          ? <>
            <nav className="sf-cards-tabs" aria-label="卡片页" data-testid="cards-tabs">
              <button type="button" className={tabClass(view === 'cards')} data-testid="cards-tab-cards" onClick={() => { setView('cards'); }}>全部卡片</button>
              <button type="button" className={tabClass(view === 'records')} data-testid="cards-tab-records" onClick={() => { setView('records'); }}>学习记录</button>
              <button type="button" className={tabClass(view === 'handout')} data-testid="cards-tab-handout" onClick={() => { setView('handout'); }}>复习讲义</button>
            </nav>
            {view === 'cards' && <>
            <ProposalInbox ctx={ctx} {...(sessionId === undefined ? {} : { sessionId })} onChanged={() => { setRefresh(value => value + 1); }} />
            <CardBrowser key={focus?.seq ?? 0} ctx={ctx} {...(sessionId === undefined ? {} : { sessionId })} refreshToken={refresh}
              {...(focus === undefined ? {} : { openTarget: focus.target })}
              {...(options.onSource === undefined ? {} : { onSource: (source: SourceAnchor) => { options.onSource?.(source, sessionId); } })}
              onLearn={target => { setStudying(target); }} />
            </>}
            {view === 'records' && <LearningRecords ctx={ctx} onOpen={openCard} />}
            {view === 'handout' && <ReviewHandout ctx={ctx} onOpen={openCard} />}
          </>
          : <ReviewScreen ctx={ctx} start={studying} {...(sessionId === undefined ? {} : { sessionId })}
            onBack={() => { setStudying(undefined); setRefresh(value => value + 1); }} />}
      </main>;
    },
  )), 'studyforge: cards page');
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: CARDS_PAGE_ID, order: 35, label: '卡片' },
    function CardsGlyph({ size }): React.JSX.Element {
      return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h11v10H4zM8 4h11v10" />
      </svg>;
    },
  )), 'studyforge: cards row');
}

function tabClass(on: boolean): string {
  return on ? 'sf-chip sf-chip-on' : 'sf-chip';
}

/**
 * One sheet per mounted client; the native frame, Conversation and rightbar are
 * untouched. It is installed and removed with the plugin's own lifetime rather
 * than kept alive by a module-level check, so a reload or hot swap really takes
 * the old sheet away instead of leaving two behind.
 */
function installStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.studyforgeStyle = 'p5';
    style.textContent = css;
    document.head.append(style);
    return () => { style.remove(); };
  }, 'studyforge: card library styles');
}
