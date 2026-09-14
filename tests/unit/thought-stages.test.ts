import { expect, test } from 'vitest';
import { projectStages, type SettledNote } from '../../packages/host/src/thought-stages.ts';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ThoughtNode } from '@studyforge/contracts/classroom-trace';
const events = [1,2,3,4].map(seq => ({ seq, time: seq * 1000, type: 'user/message' })) as SessionEvent[];
const nodes: ThoughtNode[] = events.map(e => ({ id: 'event:' + e.seq, sequence: e.seq, title: '讨论', body: '原对话', kind: 'question', sources: [], targets: [] }));
const note = (target: string, time = 2500): SettledNote => ({ batch: 'confirmation:one', title: '导数与斜率', body: '局部变化率', sources: [], related: [], change: { operationId: 'save:' + target, target, actor: 'teacher', sessionId: 's', beforeRevision: null, afterRevision: 1, changedFields: ['content'], committedAt: new Date(time).toISOString() } });
test('one confirmation becomes one stage with pinned results; remaining conversation stays pending', () => {
  const facts = [note('card:a'), note('card:b', 2501)];
  const stages = projectStages([...facts, facts[0]!], events, nodes);
  expect(stages).toHaveLength(2); expect(stages[0]!.targets.map(t => t.ref)).toEqual(['card:a', 'card:b']);
  expect(stages[0]!.stage).toMatchObject({ fromSequence: 1, toSequence: 2, messageCount: 2, pending: false });
  expect(stages[1]!.stage).toMatchObject({ fromSequence: 3, toSequence: 4, pending: true });
  expect(projectStages(facts, events, nodes)).toEqual(stages);
  expect(projectStages([], events, nodes)).toHaveLength(1);
});
test('a changed settlement invalidates an older summary without copying notes or changing facts', () => {
  const fact = note('knowledge:a'); const stage = projectStages([fact], events, nodes)[0]!;
  const edit = { ...stage, title: '局部变化率的含义', body: '已提炼的小结', stageBasis: stage.stage.basis };
  expect(projectStages([fact], events, nodes, [edit])[0]!.body).toBe('已提炼的小结');
  const changed = { ...fact, change: { ...fact.change, afterRevision: 2 } };
  const newStage = projectStages([changed], events, nodes, [edit])[0]!;
  expect(newStage.id).toBe(stage.id); expect(newStage.body).not.toBe(edit.body);
  expect(newStage.targets[0]!.version).toBe(2); expect(fact.change.afterRevision).toBe(1);
  expect(projectStages([], [], [])).toEqual([]);
});
