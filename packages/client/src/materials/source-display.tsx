import type { Context } from '@deepseek-ai/cordis';
import type { StoredEntry, SlotMap, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ChatNodeViewProps, ChatViewSlotProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { useMemo, useState, type ComponentType } from 'react';
import { decodeSourceFragments, encodeSourceFragment, type SourceFragment } from '@studyforge/contracts/source-context';
import { openLessonSource } from './native-preview-adapter.ts';
import { cardAddress } from './CardResource.tsx';

type Block = { readonly type: string; readonly text?: string };
function cleanContent<T extends Block>(blocks: readonly T[]): T[] {
  return blocks.map(block => block.type === 'text' && block.text !== undefined
    ? { ...block, text: decodeSourceFragments(block.text).text } : block);
}
function fragmentsOf(blocks: readonly Block[]): SourceFragment[] {
  return blocks.flatMap(block => block.type === 'text' && block.text !== undefined ? decodeSourceFragments(block.text).fragments : []);
}
const snapshots = new WeakMap<SessionSnapshot, SessionSnapshot>();
/** A cached read projection, never written to the native session or its draft. */
export function displaySourceSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  const old = snapshots.get(snapshot);
  if (old !== undefined) return old;
  const result: SessionSnapshot = {
    ...snapshot,
    queue: snapshot.queue.map(row => ({ ...row, content: cleanContent(row.content),
      text: row.text === null ? null : decodeSourceFragments(row.text).text,
      // The native preview can truncate inside a fence. Decode the complete
      // content first, then shorten the visible text.
      preview: fragmentsOf(row.content).length > 0
        ? cleanContent(row.content).flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim().slice(0, 240) || '已引用资料'
        : row.preview,
    })),
    pendingSubmissions: snapshot.pendingSubmissions.map(row => ({ ...row, text: decodeSourceFragments(row.text).text })),
  };
  snapshots.set(snapshot, result);
  return result;
}
function displayHook(original: SnapshotSelectorHook<SessionSnapshot>): SnapshotSelectorHook<SessionSnapshot> {
  return selector => original(snapshot => selector(displaySourceSnapshot(snapshot)));
}

function SourceLinks({ ctx, sessionId, fragments }: { ctx: Context; sessionId: string; fragments: SourceFragment[] }): React.JSX.Element | null {
  const [notice, setNotice] = useState('');
  if (fragments.length === 0) return null;
  return <div data-testid="message-sources">{fragments.flatMap((fragment, n) => {
    const current = fragment.context.currentMaterial;
    if (current?.kind === 'card' && fragment.context.selection === undefined) {
      const version = fragment.objects.find(item => item.ref === current.cardRef)?.version;
      return [<button key={n} type="button" onClick={() => {
        if (String(ctx.sessions.list.getSnapshot().current) !== sessionId || typeof version !== 'number') return;
        ctx.sidebarRight.openResource(cardAddress(current.cardRef, version));
      }}>{fragment.titles[0]?.title ?? '查看卡片'}</button>];
    }
    const sources = fragment.context.selection?.sources ?? (current?.kind === 'source' ? [current.source] : []);
    return sources.map((source, i) => <button key={n + ':' + i} type="button" onClick={() => {
      void openLessonSource({
        resolveForSession: input => ctx.remote.studyforgeMaterials.resolveForSession(input),
        openAddress: async (address, params) => { ctx.sidebarRight.openResource(address, { params }); },
      }, sessionId, source, () => String(ctx.sessions.list.getSnapshot().current ?? '')).then(outcome => {
        setNotice(outcome === 'opened' ? '' : '这处资料暂时打不开，请回资料页查看。');
      });
    }}>{fragment.titles.find(item => item.ref === source.materialId)?.title ?? fragment.titles[0]?.title ?? '查看选段'}</button>);
  })}{notice && <span role="status">{notice}</span>}</div>;
}

/** Read the public slot ledger, preserving the owner's inject/store/locale/children. */
function decorate(ctx: Context, name: keyof SlotMap & string, cell: string, wrap: (native: ComponentType<never>) => ComponentType<never>): void {
  let current: StoredEntry | undefined;
  let dispose: (() => void) | undefined;
  const install = (): void => {
    const entry = ctx.slots.entries(name).find(item => (item.options.key ?? item.options.id) === cell && item !== current && item.registrant !== 'studyforge-source-display');
    if (entry === undefined || entry === current) return;
    // This helper is called once after native registration. The ledger is
    // type-erased by the SDK; only component/priority change at this boundary.
    current = entry;
    const options = { ...entry.options, name, inject: entry.inject, store: entry.store, locale: entry.locale, children: entry.children, priority: -30 };
    const registry = ctx.slots as unknown as { register(options: object, component: ComponentType<never>): () => void };
    dispose = registry.register(options, wrap(entry.component as ComponentType<never>));
  };
  // The declaring native view may not have registered its component yet.
  const stop = ctx.slots.subscribe(name, () => { if (current === undefined) install(); });
  install();
  ctx.effect(() => () => { stop(); dispose?.(); });
}

export function registerSourceDisplay(ctx: Context): void {
  for (const kind of ['user', 'steering'] as const) decorate(ctx, 'conversation.chat.node', kind, Native => {
    const View = Native as unknown as ComponentType<ChatNodeViewProps<typeof kind>>;
    return ((props: ChatNodeViewProps<typeof kind>) => {
      const content = props.node.data.content;
      const node = { ...props.node, data: { ...props.node.data, content: cleanContent(content) } } as typeof props.node;
      const displayProps = { ...props, node } as ChatNodeViewProps<typeof kind>;
      return <><View {...displayProps} />
        <SourceLinks ctx={ctx} sessionId={String(props.sessionId)} fragments={fragmentsOf(content)} /></>;
    }) as unknown as ComponentType<never>;
  });
  type QueueProps = {
    sessionId: string; useSession: SnapshotSelectorHook<SessionSnapshot>;
    updateQueue: Context['conversation']['updateQueue'];
  };
  decorate(ctx, 'conversation.input.dock', 'queue', Native => {
    const View = Native as unknown as ComponentType<QueueProps>;
    return ((props: QueueProps) => {
      const queue = props.useSession(s => s.queue);
      const useSession = useMemo(() => displayHook(props.useSession), [props.useSession]);
      const updateQueue: QueueProps['updateQueue'] = async (id, action) => {
        if (action.kind !== 'edit') return props.updateQueue(id, action);
        const old = queue.find(row => row.id === id);
        const fragments = old === undefined ? [] : fragmentsOf(old.content);
        // Native editing owns the action; restore only its frozen references
        // and images omitted by the text editor, never refreeze against now.
        return props.updateQueue(id, { ...action, content: [
          ...action.content, ...fragments.map(fragment => ({ type: 'text' as const, text: encodeSourceFragment(fragment) })),
          ...(old?.content.filter(block => block.type !== 'text') ?? []),
        ] });
      };
      return <><View {...props} useSession={useSession} updateQueue={updateQueue} />
        {queue.map(row => <SourceLinks key={row.id} ctx={ctx} sessionId={props.sessionId} fragments={fragmentsOf(row.content)} />)}</>;
    }) as unknown as ComponentType<never>;
  });
}
