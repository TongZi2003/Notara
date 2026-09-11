import type { ContextMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useState } from 'react';
import { useDebugEnabled } from './debug-mode.ts';

/**
 * Student-facing stand-ins for the two native transcript rows that carry
 * model-facing internals: the system prompt and every non-user context
 * injection. Ordinary classroom reading must not print prompt text, plugin ids
 * or paths, so this client replaces those two keyed Chat nodes through the
 * public `conversation.chat.node` seat. The durable events, their order and the
 * Raw/Trajectory debug views keep the original bytes.
 *
 * A `recall` row is student material lifted from another lesson, so it keeps its
 * title and text; only the producer-declared internal forms are withheld.
 */
export function SystemPromptNote({ node }: PropsRuntime<'conversation.chat.node', 'system-prompt'>): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const debug = useDebugEnabled();
  if (node.data.text.trim() === '') return null;
  return <div className="sf-sysnote" data-testid="sf-system-note">
    <button type="button" className="sf-sysnote-head" aria-expanded={open} onClick={() => { setOpen(value => !value); }}>
      <span>{node.data.update === true ? '课堂准备有更新' : '课堂准备'}</span>
      <span className="sf-meta">{open ? '收起' : '说明'}</span>
    </button>
    {open && <p className="sf-note" data-testid="sf-system-note-body">
      这是这节课的内部准备，不在对话里展开。{debug ? '原文在调试视图的 Raw 里。' : ''}
    </p>}
  </div>;
}

/** One non-user context row, presented without its producer identity. */
export function ContextNote({ node }: PropsRuntime<'conversation.chat.node', 'context'>): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (node.data.provenance.role === 'recall') {
    const label = node.data.provenance.label;
    const text = contentText(node.data);
    if (text === '' && label === null) return null;
    return <details className="sf-recall" data-testid="sf-recall-note">
      <summary>{label === null ? '回顾' : `回顾 · ${label}`}</summary>
      {text !== '' && <p className="sf-note sf-recall-body">{text}</p>}
    </details>;
  }
  return <div className="sf-sysnote" data-testid="sf-context-note">
    <button type="button" className="sf-sysnote-head" aria-expanded={open} onClick={() => { setOpen(value => !value); }}>
      <span>课堂背景</span>
      <span className="sf-meta">{open ? '收起' : '说明'}</span>
    </button>
    {open && <p className="sf-note" data-testid="sf-context-note-body">
      这是这节课的内部背景，不在对话里展开。
    </p>}
  </div>;
}

/** Visible text of one context node; non-text blocks stay in the Raw debug view. */
function contentText(node: ContextMessageNode): string {
  return node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim();
}
