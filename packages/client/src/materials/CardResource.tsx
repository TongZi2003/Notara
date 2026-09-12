import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CardView } from '@studyforge/contracts/cards';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { useEffect } from 'react';
import type { SourceReferences } from './source-selection.ts';
import { CardDetail } from '../cards/CardDetail.tsx';
import { openLessonSource } from './native-preview-adapter.ts';
export const CARD_TAB_ID = '@studyforge/dsh-client/card';
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { 'studyforge-card': CardView }
}
export function cardAddress(target: string, version?: number): string {
  return 'dsh-resource://studyforge-card/' + encodeURIComponent(target) + '/' + (version ?? 'current');
}
function parse(address: string): { target: string; version?: number } | undefined {
  try {
    const url = new URL(address), parts = url.pathname.slice(1).split('/');
    if (url.protocol !== 'dsh-resource:' || url.host !== 'studyforge-card' || parts.length !== 2) return undefined;
    const target = decodeURIComponent(parts[0] ?? '');
    if (!target.startsWith('card:')) return undefined;
    if (parts[1] === 'current') return { target };
    const version = Number(parts[1]);
    return Number.isInteger(version) && version > 0 ? { target, version } : undefined;
  } catch { return undefined; }
}
type Props = PropsRuntime<'sidebar.right.pane.tab'> & { ctx: Context; references: SourceReferences };
function CardBody({ ctx, references, sessionId, useTabInfo, useResource }: Props): React.JSX.Element {
  const { tab } = useTabInfo();
  const source = useResource<'studyforge-card'>(tab.navigation.address);
  useEffect(() => {
    const value = source.value;
    if (!value || !tab.visible) return;
    return references.browse(String(tab.id), { sessionId: String(sessionId), label: value.content.title,
      context: { currentMaterial: { kind: 'card', cardRef: value.ref, cardVersion: value.version } },
    });
  }, [references, sessionId, tab.id, tab.visible, source.value]);
  if (source.status !== 'live' || source.value === undefined) return <p role="status">{source.status === 'loading' ? '正在打开卡片…' : '这张卡暂时打不开。'}</p>;
  const view = source.value;
  const fixed = parse(tab.navigation.address)?.version !== undefined;
  return <CardDetail key={tab.navigation.address} ctx={ctx} target={view.ref} seed={view} readonly={fixed} sessionId={String(sessionId)}
    onSource={anchor => { void openLessonSource({
      resolveForSession: input => ctx.remote.studyforgeMaterials.resolveForSession(input),
      openAddress: async (address, params) => { tab.actions.openResource(address, { params }); },
    }, String(sessionId), anchor, () => String(sessionId)); }} />;
}
export function registerCardResource(ctx: Context, references: SourceReferences): void {
  ctx.effect(() => ctx.resources.register({
    protocol: 'studyforge-card',
    async *open(address, { signal }) {
      const input = parse(address);
      if (input === undefined) { yield { ok: false, error: new RemoteError('gateway/bad-request', 'Invalid card address', {}) }; return; }
      try {
        const result = await ctx.remote.studyforgeLearning.card(input);
        if (!signal.aborted) yield result;
      } catch { if (!signal.aborted) yield { ok: false, error: new RemoteError('gateway/internal', 'Card unavailable', {}) }; }
    },
  }));
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: CARD_TAB_ID, kind: 'studyforge-card', patterns: ['dsh-resource://studyforge-card/**'],
    canOpen: address => parse(address) !== undefined, title: () => '卡片',
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: CARD_TAB_ID, inject: () => ({ ctx, references }),
  }, CardBody)));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: CARD_TAB_ID,
  }, ({ useTabInfo, useResource }) => {
    const { tab } = useTabInfo();
    const source = useResource<'studyforge-card'>(tab.navigation.address);
    return <>{source.value?.content.title ?? '卡片'}</>;
  })));
}
