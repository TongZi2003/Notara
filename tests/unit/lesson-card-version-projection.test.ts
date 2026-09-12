import { expect, test } from 'vitest';
import { readLessonResources } from '../../packages/domain/src/courses/lesson-resource-projection.ts';

test('lesson material nodes preserve fixed card versions and only merge the same version', () => {
  const projection = readLessonResources({ sessionId: 'lesson-version-test', messages: [
    { messageId: 'first', currentMaterial: { kind: 'card', cardRef: 'card:domain', cardVersion: 1 } },
    { messageId: 'second', currentMaterial: { kind: 'card', cardRef: 'card:domain', cardVersion: 2 } },
    { messageId: 'current', currentMaterial: { kind: 'card', cardRef: 'card:domain' } },
    { messageId: 'repeat-first', currentMaterial: { kind: 'card', cardRef: 'card:domain', cardVersion: 1 } },
  ] });
  expect(projection.resources.map(row => ({ target: row.target, version: row.cardVersion, tab: row.tabKey }))).toEqual([
    { target: 'card:domain', version: 1, tab: 'card:domain@1' },
    { target: 'card:domain', version: 2, tab: 'card:domain@2' },
    { target: 'card:domain', version: undefined, tab: 'card:domain' },
  ]);
  expect(projection.resources[0]!.origins).toEqual([{ from: 'message', messageId: 'first' }, { from: 'message', messageId: 'repeat-first' }]);
});
