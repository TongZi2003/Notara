import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_STATES } from './empty-state-client.js';

test('empty states: an action only where one really exists', () => {
  const withActions = Object.entries(EMPTY_STATES).filter(([, copy]) => copy.actions?.length).map(([key]) => key).sort();
  assert.deepEqual(withActions, ['homeNoDirectory', 'routes', 'skillsNoOverview', 'vault']);
  assert.equal(EMPTY_STATES.scheduled.actions, undefined, '定时任务 is a placeholder with nothing to press');
  assert.equal(EMPTY_STATES.routes.draft, '帮我规划一条学习路线');
  for (const [key, copy] of Object.entries(EMPTY_STATES)) assert.ok(copy.text.trim(), key);
});
