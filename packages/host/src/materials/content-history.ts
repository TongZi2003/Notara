import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import { canonicalPath } from '@studyforge/domain/access';
import type { HostContext } from '@studyforge/contracts';
import type { MaterialContext, SourceAnchor } from '@studyforge/contracts/materials';
import { ContentHistoryQuerySchema, SourceUseSchema, type ContentHistoryQuery, type ContentHistory, type ContentOccurrence } from '@studyforge/contracts/content-history';
import { sourceOverlaps, uniqueSources, unrefinedRanges } from '@studyforge/domain/source-relations';
import { materialExtent } from '@studyforge/domain/material-read';
import { sessionResources } from './session-resource.ts';

/** Rebuild relations from native messages, committed outputs and real review evidence. */
export async function contentHistory(host: Context, context: HostContext, query: ContentHistoryQuery): Promise<ContentHistory> {
  const input = ContentHistoryQuerySchema.parse(query);
  const result: ContentHistory = { classrooms: [], preparation: [], coverage: { located: [], refined: [], outline: [], unrefined: [] }, planned: [], unavailable: 0 };
  if (input.source) {
    await host.studyforgeMaterialService.resolve(context, { materialId: input.source.materialId, versionId: input.source.versionId });
    for (const node of (await host.studyforgeSkeletonService.read(context, input.source.materialId)).nodes) {
      for (const source of node.sources) if (sourceOverlaps(input.source, source)) result.coverage[node.detail === 'refined' ? 'refined' : 'outline'].push(source);
    }
    const extent = input.source.locator ? { ranges: [{ ...input.source, locator: input.source.locator }] } : await materialExtent(host.studyforgeMaterialService, context, { materialId: input.source.materialId, versionId: input.source.versionId });
    if ('pageCount' in extent && extent.pageCount) result.coverage.pageCount = extent.pageCount;
    result.coverage.unrefined = unrefinedRanges(extent.ranges, result.coverage.refined);
  } else if (input.target?.startsWith('card:')) host.studyforgeCardService.read(context, input.target, input.version);
  else if (input.target?.startsWith('knowledge:')) host.studyforgeKnowledgeService.read(context, input.target, input.version);
  else throw new Error('content_target_invalid');
  const matches = (row: ContentOccurrence): boolean => input.source
    ? !!row.source && (!input.source.locator || !!row.source.locator) && sourceOverlaps(input.source, row.source)
    : row.target === input.target && (input.version === undefined || row.version === input.version);
  const cardSources = (target: string, version: number): SourceAnchor[] => {
    if (!target.startsWith('card:')) return [];
    return host.studyforgeCardService.read(context, target, version).content.sources;
  };
  const native = await host.sessionController.list({}, AbortSignal.timeout(20_000));
  for (const session of native.items) {
    if (!session.cwd || canonicalPath(session.cwd, host.studyforgeAccess.root) !== host.studyforgeAccess.root) continue;
    const occurrences: ContentOccurrence[] = [], preparation: SourceAnchor[] = [];
    const locations = new Map<string, { sequence: number; turn: number }>();
    let occurredAt = '';
    const add = (row: ContentOccurrence): void => { if (matches(row)) occurrences.push(row); };
    const viaCard = (row: ContentOccurrence): void => {
      add(row);
      if (!input.source || !row.target || !row.version) return;
      for (const source of cardSources(row.target, row.version)) add({ ...row, source, via: row.target });
    };
    try {
      const observed = await host.sessionQuery.observeSession(SessionId(session.sessionId));
      try {
        if ((session.projections?.values.agentPreset ?? observed.header.agentPreset) !== 'studyforge-learning') continue;
        occurredAt = new Date(observed.header.createdAt).toISOString();
        let turn = 0;
        for (const event of observed.events) {
          if (event.type === 'turn/start') turn = event.data.turn;
          if (event.type === 'user/message') locations.set(String(event.data.id), { sequence: event.seq, turn });
          if (event.type === 'tool/result') locations.set(String(event.data.message.id), { sequence: event.seq, turn });
          if (event.type !== 'tool/result' || event.data.message.content.some(block => block.isError)) continue;
          const read = SourceUseSchema.safeParse(event.data.meta);
          if (!read.success) continue;
          const item = read.data, messageId = String(event.data.message.id);
          if (item.target && item.version) viaCard({ use: item.use, target: item.target, version: item.version, messageId });
          // Reading a card does not prove its original book pages were read.
          if (!item.target || item.use === 'cited') for (const source of item.sources) {
            if (!input.source || !sourceOverlaps(input.source, source)) continue;
            if (item.use === 'read') {
              result.coverage.located.push(source);
              if (item.pageCount) result.coverage.pageCount = item.pageCount;
            }
            if (session.origin === 'subagent') preparation.push(source);
            else add({ use: item.use, source, messageId });
          }
        }
      } finally { observed[Symbol.dispose](); }
      const title = typeof session.projections?.values.title === 'string' ? session.projections.values.title : '一节课';
      if (session.origin === 'subagent') {
        if (preparation.length) result.preparation.push({ sessionId: session.sessionId, title, sources: uniqueSources(preparation) });
        continue;
      }
      const resources = await sessionResources(host, session.sessionId);
      for (const row of resources.resources) for (const origin of row.origins) {
        const entry: ContentOccurrence = { use: origin.from === 'course' ? 'declared' : origin.from,
          ...(row.source ? { source: row.source } : {}), ...(row.target ? { target: row.target } : {}),
          ...(row.cardVersion ? { version: row.cardVersion } : origin.from === 'output' && origin.revision ? { version: origin.revision } : {}),
          ...(origin.from === 'message' ? { messageId: origin.messageId } : {}),
          ...(row.title ? { detail: row.title } : {}),
        };
        viaCard(entry);
      }
      // Learning claims only from the existing append-only review writer.
      for (const card of host.studyforgeCardRecords.list(context)) for (const history of card.data.history) {
        if (history.occurrence.order?.sessionId !== session.sessionId || typeof history.occurrence.cardVersion !== 'number') continue;
        for (const basis of history.basis.filter(item => item.sessionId === session.sessionId)) viaCard({ use: 'practice', target: card.ref,
          version: history.occurrence.cardVersion, messageId: basis.messageId, detail: `${history.mark} · ${history.note}` });
      }
      if (occurrences.length) {
        const seen = new Set<string>();
        result.classrooms.push({ sessionId: session.sessionId, title, occurredAt,
          archived: host.studyforgeCourseMetadata.read({ ...context, sessionId: session.sessionId }).data.archived,
          occurrences: occurrences.filter(row => { const key = JSON.stringify(row); if (seen.has(key)) return false; seen.add(key); return true; }).map(row => ({ ...row, ...(row.messageId ? locations.get(row.messageId) : {}) })) });
      }
    } catch { result.unavailable++; }
  }
  for (const node of host.studyforgeRouteService.read(context).nodes) {
    if (node.materials.materials.some(item => item.kind === 'source' ? matches({ use: 'planned', source: item.source }) : matches({ use: 'planned', target: item.cardRef, ...(item.cardVersion ? { version: item.cardVersion } : {}) }))) {
      result.planned.push({ nodeId: node.id, title: node.title, ...(node.date ? { date: node.date } : {}) });
    }
  }
  result.coverage.located = uniqueSources(result.coverage.located);
  result.coverage.refined = uniqueSources(result.coverage.refined);
  result.coverage.outline = uniqueSources(result.coverage.outline);
  result.classrooms.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return result;
}
