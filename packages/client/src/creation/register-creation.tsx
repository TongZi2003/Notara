import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import { CreationWorkspace } from './CreationWorkspace.tsx';
import { openCreation } from './creation-navigation.ts';

export function registerCreation(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.creator', priority: -20 }, () => <CreationWorkspace ctx={ctx} />)));
  function Entry({ sessionId, useSessions }: PropsRuntime<'conversation.session.header.actions'>): React.JSX.Element | null {
    const creation = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset === 'studyforge-creation');
    const [target, setTarget] = useState<string>();
    useEffect(() => {
      if (!creation) return;
      let live = true;
      void ctx.remote.studyforgeCreation.list().then(result => { if (live && result.ok) setTarget(result.value.find(item => item.sessionId === sessionId)?.ref); }).catch(() => {});
      return () => { live = false; };
    }, [creation, sessionId]);
    return creation && target ? <button className="sf-quiet" data-testid="open-creation-editor" onClick={() => openCreation(ctx, target)}>编辑与预览</button> : null;
  }
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'studyforge.creation-editor', order: 10 }, Entry)));
}
