import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useCallback, useRef, useState } from 'react';
import { LessonImport } from './LessonImport.tsx';
import { requestLessonPane } from '../materials/lesson-pane-request.ts';
import { LESSON_TAB_KIND } from './LessonPanel.tsx';
import { LessonSettingsModal } from './LessonSettings.tsx';
import './lesson-start.css';

/** Native 开始 tab: preparation belongs to this tab's session, never whichever
 * lesson happens to be selected when an asynchronous upload finishes. */
export function LessonStart({ ctx, sessionId, useSession, useSessions, useTabInfo }: PropsRuntime<'sidebar.right.tab.guide'> & { ctx: Context }): React.JSX.Element {
  const info = useTabInfo();
  const title = useSessions(state => state.byId[sessionId]?.title || '自由学习');
  const running = useSession(state => state.running);
  const [settings, setSettings] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const readCourse = useCallback((input: { sessionId: string }) => ctx.remote.studyforgeCourses.read(input), [ctx]);
  return <div className="sf-lesson-start" data-testid="lesson-deck-reopen">
    <div className="sf-start-actions">
      <button type="button" className="sf-start-entry" onClick={() => { info.tab.actions.openTab(LESSON_TAB_KIND); }}>打开工作台 <span aria-hidden="true">→</span></button>
      <button type="button" className="sf-start-settings" data-testid="open-lesson-settings" ref={trigger} onClick={() => { setSettings(true); }}>本课设置</button>
    </div>
    <div className="sf-start-upload">
      <header><h3>外部资料</h3><span>PDF / Word / 图片 / 文本</span></header>
      <LessonImport ctx={ctx} sessionId={sessionId} active={info.tab.visible} onOpen={material => {
        requestLessonPane(sessionId, { kind: 'source', title: material.title, anchors: [{ materialId: material.materialId, versionId: material.currentVersion.versionId }] });
        info.tab.actions.openTab(LESSON_TAB_KIND);
      }} />
    </div>
    {settings && <LessonSettingsModal ctx={ctx} sessionId={sessionId} title={title} readCourse={readCourse} refreshToken={running}
      onClose={() => { setSettings(false); trigger.current?.focus(); }} />}
  </div>;
}
