import { expect, test } from 'vitest';
import { ThoughtGraphSchema, type ThoughtGraph, type ThoughtNode } from '../../packages/contracts/src/classroom-trace.ts';
import { projectConversationFrames, type ConversationFrame } from '../../packages/host/src/conversation-frames.ts';

const frame = (overrides: Partial<ConversationFrame>): ConversationFrame => ({
  id: 'frame-default', title: '阶段', goal: '完成一件事', mode: 'continue', status: 'active', operationIds: [], ...overrides,
});
const node = (sequence: number): ThoughtNode => ({ id: `event:${sequence}`, title: `消息 ${sequence}`, body: '', kind: 'question', sequence, sources: [], targets: [] });
const manual = (id: string, frameId?: string): ThoughtNode => ({ id, title: id, body: '', kind: 'idea', sources: [], targets: [], ...(frameId ? { frameId } : {}) });
const graphWithFrames = (frames: ConversationFrame[]): ThoughtGraph => ThoughtGraphSchema.parse({ sessionId: 'lesson', nodes: [], edges: [], hidden: [], frames });

test('legacy graph reads with no frames and leaves event nodes unsegmented', () => {
  const graph = ThoughtGraphSchema.parse({ sessionId: 'lesson', nodes: [], edges: [], hidden: [] });
  expect(graph.frames).toEqual([]);
  expect(projectConversationFrames(graph, [node(1)]).unsegmented.map(item => item.id)).toEqual(['event:1']);
});

test('half-open sequence boundaries put later messages only in the active frame', () => {
  const graph = graphWithFrames([
    frame({ id: 'f1', startSequence: 2, endSequence: 5, status: 'completed' }),
    frame({ id: 'f2', startSequence: 5, status: 'active' }),
  ]);
  expect(projectConversationFrames(graph, [node(4), node(5), node(8)]).frames.map(item => item.nodes.map(n => n.sequence)))
    .toEqual([[4], [5, 8]]);
});

test('sequence-less manual nodes use explicit frameId and never get guessed', () => {
  const graph = graphWithFrames([frame({ id: 'f1', startSequence: 1 })]);
  const projection = projectConversationFrames(graph, [manual('m1', 'f1'), manual('m2')]);
  expect(projection.frames[0]?.nodes.map(item => item.id)).toEqual(['m1']);
  expect(projection.unsegmented.map(item => item.id)).toEqual(['m2']);
});

test('the projection does not mutate stored graph data', () => {
  const graph = graphWithFrames([frame({ id: 'f1', startSequence: 1 })]);
  const nodes = [node(1)];
  projectConversationFrames(graph, nodes);
  expect(nodes[0]?.frameId).toBeUndefined();
  expect(graph.frames[0]?.operationIds).toEqual([]);
});
