import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { HostContext, ObjectChange } from '@studyforge/contracts';
import type { ThoughtNode, ThoughtStage } from '@studyforge/contracts/classroom-trace';

export interface SettledNote {
  change: ObjectChange; title: string; body: string; sources: ThoughtNode['sources'];
  related: ThoughtNode['targets']; batch: string;
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Project only successful, substantive note writes; no review or lesson writer is called. */
export function settledNotes(host: Context, context: HostContext, events: readonly SessionEvent[]): SettledNote[] {
  const batches = new Map<string, string>();
  for (const proposal of host.studyforgeProposalService.list(context)) for (const item of proposal.items) {
    if (item.receipt) batches.set(item.receipt.operationId, proposal.ref + ':' + item.receipt.confirmationId);
  }
  const batch = (change: ObjectChange): string => {
    const receipt = batches.get(change.operationId); if (receipt) return receipt;
    const call = events.find(event => event.type === 'tool/call' && change.operationId.startsWith('native:' + context.sessionId + ':' + event.data.callId + ':'));
    return call?.type === 'tool/call' ? 'turn:' + call.data.turn : change.operationId;
  };
  const result: SettledNote[] = [];
  for (const row of host.studyforgeCardRecords.list(context, { includeDeleted: true })) {
    for (const change of host.studyforgeCardRecords.changes(context, row.ref)) {
      if (change.sessionId !== context.sessionId || !change.changedFields.includes('content')) continue;
      const after = host.studyforgeCardRecords.read(context, row.ref, change.afterRevision).data.content;
      const before = change.beforeRevision === null ? undefined : host.studyforgeCardRecords.read(context, row.ref, change.beforeRevision).data.content;
      const noteChanged = after.notes.trim() && after.notes !== before?.notes;
      const prose = ['note', 'insight'].includes(after.presentation) &&
        (after.front !== before?.front || JSON.stringify(after.sections) !== JSON.stringify(before?.sections));
      if (!noteChanged && !prose) continue;
      const body = noteChanged ? after.notes : [after.front, ...after.sections.map(s => s.heading + '\n' + s.body)].join('\n\n');
      if (!body.trim()) continue;
      result.push({ change, title: after.title, body, sources: after.sources, related: after.links.flatMap(ref => {
        try { const version = host.studyforgeCardRecords.changes(context, ref).filter(c => c.committedAt <= change.committedAt).at(-1)?.afterRevision; if (!version) return []; const card = host.studyforgeCardRecords.read(context, ref, version); return [{ ref, version, title: card.data.content.title }]; } catch { return []; }
      }), batch: batch(change) });
    }
  }
  for (const row of host.studyforgeKnowledgeRecords.list(context, { includeDeleted: true })) {
    for (const change of host.studyforgeKnowledgeRecords.changes(context, row.ref)) {
      if (change.sessionId !== context.sessionId || !change.changedFields.includes('content')) continue;
      const after = host.studyforgeKnowledgeRecords.read(context, row.ref, change.afterRevision).data.content;
      const before = change.beforeRevision === null ? undefined : host.studyforgeKnowledgeRecords.read(context, row.ref, change.beforeRevision).data.content;
      if (before?.body === after.body) continue;
      result.push({ change, title: after.title, body: after.body, sources: [], related: [], batch: batch(change) });
    }
  }
  return result;
}

export function projectStages(notes: readonly SettledNote[], events: readonly SessionEvent[], nodes: readonly ThoughtNode[], edits: readonly ThoughtNode[] = []): ThoughtStage[] {
  const groups = new Map<string, SettledNote[]>();
  for (const note of notes) { const group = groups.get(note.batch) ?? []; if (!group.some(n => n.change.operationId === note.change.operationId && n.change.target === note.change.target)) group.push(note); groups.set(note.batch, group); }
  const ordered = [...groups.entries()].map(([batch, group]) => {
    const time = Math.max(...group.map(n => Date.parse(n.change.committedAt)));
    const cutoff = events.filter(e => e.time <= time).at(-1)?.seq ?? -1;
    return { batch, group: group.sort((a,b) => a.change.committedAt.localeCompare(b.change.committedAt) || a.change.target.localeCompare(b.change.target)), time, cutoff };
  }).sort((a,b) => a.time - b.time || a.batch.localeCompare(b.batch));
  let previous = -1;
  const stages: ThoughtStage[] = [];
  for (const { batch, group, cutoff } of ordered) {
    const id = 'stage:' + hash(batch), basis = hash(group.map(n => [n.change.operationId, n.change.target, n.change.afterRevision]));
    const messages = nodes.filter(n => n.sequence !== undefined && n.sequence > previous && n.sequence <= cutoff && n.id.startsWith('event:'));
    const first = messages[0], last = messages.at(-1), edit = edits.find(n => n.id === id && n.stageBasis === basis);
    const targets: ThoughtNode['targets'] = [];
    for (const note of group) for (const target of [{ ref: note.change.target, version: note.change.afterRevision, title: note.title }, ...note.related]) {
      if (!targets.some(t => t.ref === target.ref && t.version === target.version)) targets.push(target);
    }
    stages.push({ id, kind: 'conclusion', title: edit?.title ?? group[0]!.title,
      body: edit?.body ?? group.map(n => '### ' + n.title + '\n\n' + n.body.slice(0,4000)).join('\n\n').slice(0,20000),
      ...(last?.sequence === undefined ? {} : { sequence: last.sequence, turn: last.turn }),
      ...(edit?.position ? { position: edit.position } : {}), stageBasis: basis,
      sources: group.flatMap(n => n.sources), targets,
      stage: { ...(first ? { fromSequence: first.sequence!, toSequence: last!.sequence! } : {}), operations: group.map(n => n.change.operationId), pending: false, basis, summary: edit ? 'edited' : 'notes', messageCount: messages.length },
    });
    previous = Math.max(previous, cutoff);
  }
  const pending = nodes.filter(n => n.id.startsWith('event:') && n.sequence! > previous && n.kind !== 'result');
  if (pending.length) stages.push({ id: 'stage:pending', title: '进行中', body: '这段讨论尚未沉淀为笔记。', kind: 'idea', sources: [], targets: [], sequence: pending.at(-1)!.sequence, turn: pending.at(-1)!.turn,
    stage: { fromSequence: pending[0]!.sequence!, toSequence: pending.at(-1)!.sequence!, operations: [], pending: true, basis: hash(pending.map(n => n.id)), summary: 'notes', messageCount: pending.length } });
  return stages;
}
