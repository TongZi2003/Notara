import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ToolCallBlock, ToolCallId } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { MessageImageSource, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { useState } from 'react';
import { prettyToolArguments, toolDisplayCopy, type ToolDisplayState } from './tool-copy.ts';
import './tool-activity.css';

type ToolNodeProps = PropsRuntime<'conversation.chat.node', 'tool-call'>;
type ProcessProps = PropsRuntime<'conversation.chat.node', 'turn-process'>;

/** Replace presentation only; native nodes still own ordering, folding and calls. */
export function registerToolActivity(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', function* () {
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'tool-call', priority: -10 }, ToolActivity);
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

function ToolActivity({ node, inspectCall, renderMessageImages }: ToolNodeProps): React.JSX.Element {
  return <ToolStep block={node.data.root} inspectCall={inspectCall} renderMessageImages={renderMessageImages} />;
}

function ToolStep({ block, inspectCall, renderMessageImages }: {
  block: ToolCallBlock;
  inspectCall: (callId: ToolCallId) => void;
  renderMessageImages: RenderMessageImages;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const settled = 'kind' in block;
  const name = settled ? block.call?.name ?? '' : block.name;
  const raw = settled ? block.call?.argsRaw ?? '' : block.argsRaw;
  const state: ToolDisplayState = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok';
  const images: MessageImageSource[] = settled ? block.content.flatMap(part => part.type === 'image' && 'attachment' in part
    ? [{ attachment: part.attachment }] : []) : [];
  return <div className="sf-tool-step" data-testid="tool-activity" data-tool-state={state}>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary data-testid="tool-activity-summary">
        <span className="sf-tool-state" aria-hidden="true">{state === 'running' ? '◌' : state === 'ok' ? '✓' : state === 'error' ? '!' : '·'}</span>
        <span>{toolDisplayCopy(name, state, raw)}</span><span className="sf-tool-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
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
    {block.subCalls.length > 0 && <div className="sf-tool-children">{block.subCalls.map(child =>
      <ToolStep key={child.callId} block={child} inspectCall={inspectCall} renderMessageImages={renderMessageImages} />)}</div>}
  </div>;
}
