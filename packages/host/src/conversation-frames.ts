import { ConversationFrameSchema, type ConversationFrame, type ConversationFrameView, type ThoughtGraph, type ThoughtNode } from '@studyforge/contracts/classroom-trace';

export type { ConversationFrame } from '@studyforge/contracts/classroom-trace';

export interface ConversationFrameProjection {
  readonly frames: ConversationFrameView[];
  readonly activeFrameId: string | undefined;
  readonly unsegmented: ThoughtNode[];
}

/**
 * Read-only frame projection. Message ranges are half-open so closing one
 * frame and opening the next at the same sequence cannot duplicate a node.
 */
export function projectConversationFrames(graph: ThoughtGraph, nodes: readonly ThoughtNode[]): ConversationFrameProjection {
  const frames = graph.frames.map(frame => ConversationFrameSchema.parse(frame));
  const byId = new Map(frames.map(frame => [frame.id, frame]));
  for (const frame of frames) {
    if (frame.parentFrameId && !byId.has(frame.parentFrameId)) throw new Error('frame_parent_missing');
    if (frame.resumeFrameId && !byId.has(frame.resumeFrameId)) throw new Error('frame_resume_missing');
  }
  for (let left = 0; left < frames.length; left += 1) for (let right = left + 1; right < frames.length; right += 1) {
    const a = frames[left]!, b = frames[right]!, start = Math.max(a.startSequence ?? 0, b.startSequence ?? 0);
    const end = Math.min(a.endSequence ?? Number.POSITIVE_INFINITY, b.endSequence ?? Number.POSITIVE_INFINITY);
    if (start < end) throw new Error('frame_sequence_overlap');
  }
  const projected = frames.map(frame => ({ ...frame, nodes: [] as ThoughtNode[] }));
  const viewById = new Map(projected.map(frame => [frame.id, frame]));
  for (const node of nodes) {
    const explicit = node.frameId === undefined ? undefined : byId.get(node.frameId);
    const owner = explicit ?? frames.find(frame => {
      if (node.sequence === undefined) return false;
      const start = frame.startSequence ?? 0;
      return node.sequence >= start && (frame.endSequence === undefined || node.sequence < frame.endSequence);
    });
    if (owner) viewById.get(owner.id)!.nodes.push(structuredClone(node));
  }
  const assigned = new Set(projected.flatMap(frame => frame.nodes.map(node => node.id)));
  const unsegmented = nodes.filter(node => !assigned.has(node.id)).map(node => structuredClone(node));
  const active = frames.findLast(frame => frame.status === 'active');
  return { frames: projected, activeFrameId: active?.id, unsegmented };
}
