import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleTagOptions } from './views-client.js';

test('tag filters expose selected matches and cap the rendered list', () => {
  const tags = ['代数', '函数', '几何', '极限', '积分'];
  assert.deepEqual(visibleTagOptions(tags, '', '极限', 2), {
    items: ['极限', '代数'],
    hidden: 3,
  });
  assert.deepEqual(visibleTagOptions(tags, '函', '', 2), {
    items: ['函数'],
    hidden: 0,
  });
});
