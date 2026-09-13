import { expect } from 'vitest';
import type { RouteView } from '@studyforge/contracts/routes';
import { liveTest, createLesson, turn, proposals, calledTools, confirmItems, value } from '../fixtures/live-classroom.ts';

/** Natural request: no tool name, schema, or loader hint is supplied by the test. */
liveTest('渐进工具：自然排课请求自行加载接口，提案确认后才产生课程路线', async classroom => {
  const sessionId = await createLesson(classroom);
  const before = value(await classroom.client.rpc<RouteView>('studyforgeOrganization/route', {}));
  expect(before.nodes).toHaveLength(0);
  const response = await turn(classroom, sessionId, '帮我安排三节后续课，依次学习定义域、单调性和值域。每节只学这一个主题，不指定日期和资料，给我排课提案，我确认后再保存。');
  const calls = calledTools(response.events);
  expect(calls).toContain('load_tools');
  expect(calls).toContain('propose_route');
  expect(calls.indexOf('load_tools')).toBeLessThan(calls.indexOf('propose_route'));
  const rows = (await proposals(classroom, sessionId)).filter(proposal => proposal.items.some(item => item.draft.effect.kind === 'route-add'));
  expect(rows.length).toBeGreaterThan(0);
  expect(value(await classroom.client.rpc<RouteView>('studyforgeOrganization/route', {})).nodes).toHaveLength(0);
  for (const proposal of rows) {
    const selected = proposal.items.filter(item => item.draft.effect.kind === 'route-add').map(item => ({
      itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline,
    }));
    const saved = await confirmItems(classroom, proposal, selected);
    expect(saved.items.filter(item => selected.some(choice => choice.itemId === item.id)).every(item => item.status === 'applied')).toBe(true);
  }
  const route = value(await classroom.client.rpc<RouteView>('studyforgeOrganization/route', {}));
  expect(route.nodes).toHaveLength(3);
  for (const title of ['定义域', '单调性', '值域']) expect(route.nodes.map(node => node.title).join('、')).toContain(title);
});
