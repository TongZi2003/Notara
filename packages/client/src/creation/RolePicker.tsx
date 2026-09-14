import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { openCreation } from './creation-navigation.ts';
import { useState } from 'react';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { ControlPopover } from '../classroom/ControlPopover.tsx';

export function RolePicker({ ctx, sessionId, useSessions }: PropsRuntime<'conversation.input.right'> & { ctx: Context }): React.JSX.Element | null {
  const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  if (preset !== 'studyforge-learning' && preset !== 'studyforge-creation') return null;
  async function teaching(): Promise<void> {
    setBusy(true); setNotice('');
    try {
      const current = ctx.sessions.list.getSnapshot();
      const previous = current.ids.find(id => current.byId[id]?.projectionValues?.agentPreset === 'studyforge-learning');
      if (previous) { ctx.sessions.open(previous); ctx.layout.selectPanel(null); }
      else {
        const result = await ctx.remote.studyforgeCreation.openTeacher();
        if (!result.ok) throw new Error('teacher_open_failed');
        await ctx.sessions.refresh(); ctx.sessions.open(result.value.sessionId as SessionId); ctx.layout.selectPanel(null);
      }
    } catch { setNotice('暂时没能打开教学对话，请重试。'); }
    finally { setBusy(false); }
  }
  return <div className="sf-learning-mode">
    <ControlPopover title="智能体身份" triggerTestId="agent-role" value={preset === 'studyforge-creation' ? 'creator' : 'teacher'} disabled={busy} chevron={false}
      label={<><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="10" cy="6" r="3" /><path d="M4 17v-2a6 6 0 0 1 12 0v2M7 17v-3M13 17v-3" /></svg><span>Agent</span></>}>
      {close => <div className="sf-agent-options">{(['teacher', 'creator'] as const).map(role => {
        const selected = role === (preset === 'studyforge-creation' ? 'creator' : 'teacher');
        return <button type="button" key={role} aria-pressed={selected} disabled={busy} onClick={() => {
          close(); if (selected) return; if (role === 'creator') openCreation(ctx); else void teaching();
        }}><span>{role === 'teacher' ? '教学者' : '创作者'}</span><span aria-hidden="true">{selected ? '✓' : ''}</span></button>;
      })}</div>}
    </ControlPopover>
    {notice && <span role="status">{notice}</span>}
  </div>;
}
