import { expect, test } from 'vitest';
import { requestLessonPane, subscribeLessonPane } from '../../packages/client/src/materials/lesson-pane-request.ts';

test('a pending source request waits for its own lesson rather than the next mounted lesson', () => {
  const request = { kind: 'card' as const, title: '旧版题卡', target: 'card:a', version: 1 };
  const received: unknown[] = [], other: unknown[] = [];
  requestLessonPane('lesson:a', request);
  const stopOther = subscribeLessonPane('lesson:b', value => other.push(value));
  expect(other).toEqual([]);
  const stop = subscribeLessonPane('lesson:a', value => received.push(value));
  expect(received).toEqual([request]);
  stop(); stopOther();
  const stopAgain = subscribeLessonPane('lesson:a', value => received.push(value));
  expect(received).toEqual([request]);
  stopAgain();
});
