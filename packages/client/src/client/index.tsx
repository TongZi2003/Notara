import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import contribution from '@studyforge/host/remote';
import { useState } from 'react';
import { registerStudentShell } from '../shell/register-slots.tsx';

export const inject = ['remote', 'slots'];

/** A development-only surface, replaced by the student shell in P0.3. */
export async function apply(ctx: Context): Promise<void> {
  const unmountRemote = await ctx.remote.$mount(contribution);
  ctx.effect(() => unmountRemote);
  if (new URLSearchParams(window.location.search).get('studyforge-probe') === '1') {
    ctx.plugin({ inject: ['remote', 'remote.studyforgeProbe', 'slots'], apply: registerProbe });
  } else {
    ctx.plugin({ inject: ['slots', 'sessions', 'layout', 'sidebarRight', 'documentPreviews'], apply: registerStudentShell });
  }
}

function registerProbe(ctx: Context): void {
  function ProbePanel(): React.JSX.Element {
    const [result, setResult] = useState('尚未请求');
    const [pending, setPending] = useState(false);
    async function inspect(): Promise<void> {
      setPending(true);
      const nonce = crypto.randomUUID();
      try {
        const reply = await ctx.remote.studyforgeProbe.inspect({ nonce });
        if (!reply.ok) {
          setResult(`连接不可用 · ${reply.error.code}: ${reply.error.message}`);
        } else if (reply.value.echoedNonce !== nonce) {
          setResult('NONCE_MISMATCH');
        } else {
          setResult(`${reply.value.workspaceLabel} · ${reply.value.echoedNonce}`);
        }
      } catch (error) {
        setResult(error instanceof Error ? error.message : 'Remote failed');
      } finally {
        setPending(false);
      }
    }
    return <main style={{ padding: 32 }} data-testid="probe-panel">
      <h1>StudyForge · 接入验证</h1>
      <button data-testid="probe-send" disabled={pending} onClick={() => { void inspect(); }}>检查连接</button>
      <p data-testid="probe-result">{result}</p>
    </main>;
  }
  ctx.effect(() => ctx.slots.register({ name: 'root', priority: -10 }, ProbePanel));
}
