import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ToolCallBlock, ToolCallId } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { MessageImageSource, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { useState } from 'react';
import { prettyToolArguments, toolDisplayCopy, type ToolDisplayState } from './tool-copy.ts';
import './tool-activity.css';
import { ArtifactViewSchema } from '@studyforge/contracts/creation';
import { openCreation } from '../creation/creation-navigation.ts';
import { useDebugEnabled } from '../debug/debug-mode.ts';

type ToolNodeProps = PropsRuntime<'conversation.chat.node', 'tool-call'>;
type ProcessProps = PropsRuntime<'conversation.chat.node', 'turn-process'>;

/** Replace presentation only; native nodes still own ordering, folding and calls. */
export function registerToolActivity(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', function* () {
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'tool-call', priority: -10 }, props => <ToolActivity {...props} ctx={ctx} />);
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-process', priority: -10 }, ProcessActivity);
  }));
}

function ProcessActivity({ node, turnProcess }: ProcessProps): React.JSX.Element | null {
  if (!turnProcess?.foldable) return null;
  const count = node.data.toolCallCount;
  return <button type="button" className="sf-tool-process" data-testid="tool-process-toggle"
    aria-expanded={turnProcess.open} onClick={() => turnProcess.setOpen(!turnProcess.open)}>
    <span aria-hidden="true">{turnProcess.open ? '▾' : '▸'}</span>
    老师的准备过程{count ? ` · ${count} 步` : ''}
  </button>;
}

function ToolActivity({ node, inspectCall, renderMessageImages, ctx }: ToolNodeProps & { ctx: Context }): React.JSX.Element {
  return <ToolStep ctx={ctx} block={node.data.root} inspectCall={inspectCall} renderMessageImages={renderMessageImages} />;
}

function ToolStep({ block, inspectCall, renderMessageImages, ctx }: {
  ctx: Context;
  block: ToolCallBlock;
  inspectCall: (callId: ToolCallId) => void;
  renderMessageImages: RenderMessageImages;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const debug = useDebugEnabled();
  const settled = 'kind' in block;
  const name = settled ? block.call?.name ?? '' : block.name;
  const raw = settled ? block.call?.argsRaw ?? '' : block.argsRaw;
  const state: ToolDisplayState = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok';
  const resultRaw = settled ? block.content.find(part => part.type === 'text')?.text ?? '' : '';
  if (!debug && ['ask_classmate', 'continue_classmate', 'read_classroom', 'update_classroom_context'].includes(name)) {
    const copy: Record<string, string> = { ask_classmate: '安排同学参与', continue_classmate: '继续同学任务', read_classroom: '查看教室安排', update_classroom_context: '更新课堂背景' };
    return <div className="sf-tool-step" data-testid="classroom-private-tool" data-tool-state={state}><span className="sf-tool-state" aria-hidden="true">{state === 'running' ? '◌' : state === 'ok' ? '✓' : '·'}</span> {copy[name]}{state === 'running' ? '…' : state === 'error' ? '未完成' : state === 'stopped' ? '已停止' : ''}</div>;
  }
  let artifact: { ref: string; title: string } | undefined;
  if (name === 'draft_artifact' && state === 'ok') { try { const parsed = ArtifactViewSchema.safeParse(JSON.parse(resultRaw)); if (parsed.success) artifact = { ref: parsed.data.ref, title: parsed.data.manifest?.title ?? '课堂作品' }; } catch { /* incomplete result remains in details */ } }
  const artifactCard = artifact && <button className="sf-artifact-card" data-testid="classroom-artifact" onClick={() => openCreation(ctx, artifact!.ref)}><strong>{artifact.title}</strong><span>预览与共同编辑 ↗</span></button>;
  const children = block.subCalls.length > 0 && <div className="sf-tool-children">{block.subCalls.map(child =>
    <ToolStep ctx={ctx} key={child.callId} block={child} inspectCall={inspectCall} renderMessageImages={renderMessageImages} />)}</div>;
  if (!debug) return <div className="sf-tool-step" data-testid="tool-activity" data-tool-state={state}>
    {artifactCard}
    <div className="sf-tool-plain" data-testid="tool-activity-summary">
      <span className="sf-tool-state" aria-hidden="true">{state === 'running' ? '◌' : state === 'ok' ? '✓' : state === 'error' ? '!' : '·'}</span>
      <span>{toolDisplayCopy(name, state, raw, resultRaw)}</span>
    </div>
    {children}
  </div>;
  const images: MessageImageSource[] = settled ? block.content.flatMap(part => part.type === 'image' && 'attachment' in part
    ? [{ attachment: part.attachment }] : []) : [];
  return <div className="sf-tool-step" data-testid="tool-activity" data-tool-state={state}>
    {artifactCard}
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary data-testid="tool-activity-summary">
        <span className="sf-tool-state" aria-hidden="true">{state === 'running' ? '◌' : state === 'ok' ? '✓' : state === 'error' ? '!' : '·'}</span>
        <span>{toolDisplayCopy(name, state, raw, resultRaw)}</span><span className="sf-tool-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </summary>
      {open && <div className="sf-tool-details" data-testid="tool-activity-details">
        <div className="sf-tool-details-head"><strong>{name || '原调用信息不在当前记录中'}</strong>
          <button type="button" onClick={() => inspectCall(block.callId as ToolCallId)}>查看工具定义与完整记录</button></div>
        <h4>参数</h4><pre>{raw ? prettyToolArguments(raw) : '没有可显示的参数'}</pre>
        {images.length > 0 && renderMessageImages({ images, align: 'start' })}
        {settled && <><h4>结果</h4><pre>{block.content.length
          ? block.content.map(part => part.type === 'text' ? part.text : JSON.stringify(part, null, 2)).join('\n\n')
          : block.error ? JSON.stringify(block.error, null, 2) : '这次调用没有返回正文'}</pre></>}
      </div>}
    </details>
    {children}
  </div>;
}
