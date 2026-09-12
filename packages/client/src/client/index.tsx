import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
// Brings the generated Host-for-Client namespace declarations (session, workspace,
// files) that type `ctx.remote` and the Session standard props.
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import contribution from '@studyforge/host/remote';
import { useState } from 'react';
import { registerDebugSurfaces } from '../debug/register-debug.ts';
import { registerStudentShell } from '../shell/register-slots.tsx';
import { registerClassroom } from '../classroom/Classroom.tsx';
import { registerMaterials } from '../materials/register-materials.tsx';
import { registerCardSurfaces } from '../cards/register-cards.tsx';
import { registerOrganization } from '../planning/register-organization.tsx';
import { MaterialNavigation } from '../materials/material-navigation.ts';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { registerCourses } from '../courses/register-courses.tsx';
import { registerNotebook } from '../theme/notebook.tsx';
import { registerNotebookSidebar } from '../shell/NotebookSidebar.tsx';
import { registerToolActivity } from '../classroom/ToolActivity.tsx';

export const inject = ['remote', 'slots'];

/** Mount the Host Remote, then contribute student pages and the native classroom seats. */
export async function apply(ctx: Context): Promise<void> {
  const materialNavigation = new MaterialNavigation();
  const unmountRemote = await ctx.remote.$mount(contribution);
  ctx.effect(() => unmountRemote);
  if (new URLSearchParams(window.location.search).get('studyforge-probe') === '1') {
    ctx.plugin({ inject: ['remote', 'remote.studyforgeProbe', 'slots'], apply: registerProbe });
    return;
  }
  ctx.plugin({ inject: ['slots', 'layout', 'sessions'], apply: registerStudentShell });
  ctx.plugin({ inject: ['slots'], apply: registerToolActivity });
  ctx.plugin({ inject: ['slots', 'layout', 'sessions', 'uiWorkspace', 'remote.studyforgeOrganization'], apply: registerNotebookSidebar });
  ctx.plugin({ inject: ['theme', 'slots', 'layout', 'sessions'], apply: scope => registerNotebook(scope, materialNavigation) });
  // Remote namespaces are separately injected properties: reading
  // `ctx.remote.studyforgeCourses` needs its own nested inject entry.
  ctx.plugin({ inject: ['remote.studyforgeCourses', 'remote.studyforgeMaterials', 'remote.studyforgeTeaching', 'remote.studyforgeMemory', 'remote.studyforgeLearning', 'remote.studyforgeOrganization', 'remote.studyforgeHandoffs', 'remote.studyforgeProposals', 'slots', 'uiConversation', 'sidebarRight', 'sidebarRightTabs', 'layout', 'sessions'], apply: registerClassroom });
  // The student-facing system note and the opt-in Raw debug surfaces read the
  // same session binding the native Chat owns; they open no second source.
  ctx.plugin({ inject: ['remote.studyforgeCourses', 'slots', 'sessions'], apply: registerDebugSurfaces });
  // The materials page needs the Host's own material Remote plus the native
  // document-preview registry it adds a DOCX renderer to.
  ctx.plugin({ inject: ['remote.studyforgeMaterials', 'remote.studyforgeSources', 'remote.studyforgeLearning', 'remote.studyforgeOrganization', 'resources', 'sidebarRightTabs', 'documentPreviews', 'slots', 'sidebarRight', 'layout', 'inputTriggers', 'conversation', 'sessions'], apply: scope => registerMaterials(scope, materialNavigation) });
  ctx.plugin({ inject: ['remote.studyforgeLearning', 'remote.studyforgeProposals', 'remote.studyforgeMaterials', 'remote.studyforgeTeaching', 'remote.studyforgeOrganization', 'slots', 'layout'], apply: scope => registerCardSurfaces(scope, { onSource: (source, sessionId) => { materialNavigation.show(source, sessionId); scope.layout.selectPanel('studyforge.materials' as MainPanelId); } }) });
  ctx.plugin({ inject: ['remote.studyforgeOrganization', 'remote.studyforgeCalendar', 'remote.studyforgeMaterials', 'remote.studyforgeLearning', 'remote.studyforgeMemory', 'remote.studyforgeHandoffs', 'sessions', 'slots', 'layout', 'uiWorkspace'], apply: scope => registerOrganization(scope, materialNavigation) });
  ctx.plugin({ inject: ['remote.studyforgeOrganization', 'remote.studyforgeCalendar', 'remote.studyforgeMaterials', 'remote.studyforgeLearning', 'remote.studyforgeTeaching', 'sessions', 'slots', 'layout'], apply: registerCourses });
  // P4.3: the composer's own reference source and its dock row. Kept in a
  // separate entry so a composition without a conversation surface still gets
  // the materials page.
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
