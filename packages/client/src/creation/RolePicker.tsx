import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { openCreation } from './creation-navigation.ts';
import { useState } from 'react';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

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
    <select aria-label="智能体身份" data-testid="agent-role" value={preset === 'studyforge-creation' ? 'creator' : 'teacher'} disabled={busy}
      onChange={event => { if (event.target.value === 'creator') openCreation(ctx); else void teaching(); }}>
      <option value="teacher">教学者</option><option value="creator">创作者</option>
    </select>
    {notice && <span role="status">{notice}</span>}
  </div>;
}
