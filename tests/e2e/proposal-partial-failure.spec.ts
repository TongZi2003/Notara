/**
 * P5.3 what really fails, and what that failure is allowed to touch.
 *
 * Two real outcomes are pinned here, both produced by Host code rather than by
 * a scripted stub:
 *
 * 1. `propose_route` refuses a planned node whose parent is not there *while
 *    proposing*, so a bad node never half-enters the record — nothing is stored
 *    and the lesson shows the writer's own refusal.
 * 2. An item whose frozen baseline went stale between propose and confirm
 *    fails on its own: its target is untouched, the item stays retryable, and
 *    another proposal in the same lesson is not dragged down with it.
 *
 * Today no Host tool proposes one record with mixed per-item outcomes: the
 * only multi-item tool (`route-add`) validates at propose time and every other
 * kind is a single item. So per-item independence inside one record is covered
 * by the projector's own tests, not by a browser flow — what a browser can
 * really show is the two cases above.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput, openRoot } from './fixtures/classroom.ts';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { RouteView } from '@studyforge/contracts/routes';
import type { SetView } from '@studyforge/contracts/sets';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

/** The first-run dialog comes back on a reload; it is modal, so it is dismissed first. */
async function dismissNotices(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count() === 0) continue;
    try { await button.click({ timeout: 2_000 }); } catch { /* it was already gone */ }
  }
}

/** The card library, wherever the client root mounts it. */
async function openCards(page: Page): Promise<void> {
  await dismissNotices(page);
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '卡片与笔记', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

async function proposalCount(dsh: IsolatedRuntime): Promise<number> {
  const client = await connectRuntime(dsh);
  const list = await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} });
  return list.ok ? list.value.length : -1;
}

test('a planned node with no real parent is refused before anything is stored', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  const client = await connectRuntime(dsh);

  const scripted = {
    name: 'propose_route',
    arguments: {
      action: 'add',
      nodes: [
        { title: '第一节：集合', parent: null, materials: { materials: [] } },
        { title: '第二节：函数', parent: '不存在的节点', materials: { materials: [] } },
      ],
    },
  };
  await sendInput(page, '[tool]' + JSON.stringify(scripted));

  // Wait for the actual turn to settle before checking that neither node was
  // proposed or saved. Disclosure placement belongs to the native trace UI.
  await expect.poll(async () => {
    const sessions = await client.rpc<SessionListValue>('session/list', { _request: {} });
    return sessions.ok && sessions.value.items.length > 0 && sessions.value.items.every(item => !item.running);
  }).toBe(true);
  await expect(page.getByTestId('inline-proposal')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('route-refused.png'), fullPage: true });
  expect(await proposalCount(dsh)).toBe(0);
  // A Remote with no parameters is addressed without an `input` wrapper.
  const route = await client.rpc<RouteView>('studyforgeOrganization/route', {});
  expect(route.ok ? route.value.nodes : ['<read failed>']).toEqual([]);

  await openCards(page);
  // The lesson panel mounts its own copy of this inbox; this spec drives the library's.
  const lib = page.getByTestId('studyforge-page-studyforge.cards');
  await expect(lib.getByTestId('proposal-inbox')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a stale item fails alone, keeps its target, and leaves the other proposal alone', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  const client = await connectRuntime(dsh);

  const created = await client.rpc<SetView>('studyforgeOrganization/createSet', { input: {
    operationId: crypto.randomUUID(), set: { name: '第一轮复习', subjects: [] },
  } });
  if (!created.ok) throw new Error('createSet failed: ' + created.error.message);
  const ref = created.value.ref;

  // Two proposals in the same lesson: one edits the set, one creates a card.
  // The edit path is bound to what the model really read first, so the read is
  // a real turn of its own instead of a version the spec made up.
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'read_set', arguments: { target: ref } }));
  await expect.poll(() => proposalCount(dsh), { timeout: 10_000 }).toBe(0);
  await sendInput(page, '[tool]' + JSON.stringify({
    name: 'propose_set', arguments: { action: 'edit', target: ref, patch: { name: '期末复习' } },
  }));
  await expect.poll(() => proposalCount(dsh), { timeout: 40_000 }).toBe(1);
  await sendInput(page, '[tool]' + JSON.stringify({
    name: 'propose_card', arguments: { kind: 'card', title: '分母不能为零', front: '先写条件。', presentation: 'flashcard' },
  }));
  await expect.poll(() => proposalCount(dsh), { timeout: 40_000 }).toBe(2);

  // Another writer moves the set after the proposal froze its baseline.
  const moved = await client.rpc<SetView>('studyforgeOrganization/updateSet', { input: {
    operationId: crypto.randomUUID(), ref, expectedVersion: created.value.version, patch: { name: '别处先改的名字' },
  } });
  expect(moved.ok).toBe(true);

  await openCards(page);
  // The lesson panel mounts its own copy of this inbox; this spec drives the library's.
  const lib = page.getByTestId('studyforge-page-studyforge.cards');
  const setProposal = lib.getByTestId('proposal-card').filter({ hasText: '调整学习集' });
  const cardProposal = lib.getByTestId('proposal-card').filter({ hasText: '新卡片' });
  await expect(setProposal).toHaveCount(1);
  await expect(cardProposal).toHaveCount(1);
  await expect(setProposal.getByTestId('proposal-content')).toContainText('改这个学习集');
  await expect(setProposal.getByTestId('proposal-content')).toContainText('名字改成「期末复习」');
  await expect(setProposal.getByTestId('proposal-edit')).toBeEnabled();
  await expect(setProposal).not.toContainText('细节暂时改不了');
  await page.screenshot({ path: testInfo.outputPath('failure-waiting.png'), fullPage: true });

  await setProposal.getByTestId('proposal-confirm').click();
  await expect(setProposal.getByTestId('proposal-item')).toHaveAttribute('data-item-status', 'failed');
  await expect(setProposal.getByTestId('proposal-failure')).toContainText('没有写进去');
  await expect(setProposal.getByTestId('proposal-retry')).toBeVisible();
  await setProposal.getByTestId('proposal-edit').click();
  await expect(setProposal.getByTestId('organization-draft-actions')).toBeVisible();
  await expect(setProposal.getByTestId('proposal-retry')).toHaveCount(0);
  await setProposal.getByTestId('draft-cancel').click();
  await expect(setProposal.getByTestId('proposal-reject')).toBeEnabled();
  // The failed item wrote nothing: the other writer's name is still the stored one.
  const after = await client.rpc<SetView>('studyforgeOrganization/set', { input: { ref } });
  expect(after.ok ? after.value.name : '').toBe('别处先改的名字');
  // It did not touch the other proposal either.
  await expect(cardProposal.getByTestId('proposal-item')).toHaveAttribute('data-item-status', 'pending');
  await page.screenshot({ path: testInfo.outputPath('failure-alone.png'), fullPage: true });

  await cardProposal.getByTestId('proposal-confirm').click();
  await expect(cardProposal.getByTestId('proposal-item')).toHaveAttribute('data-item-status', 'applied');
  await expect(cardProposal.getByTestId('proposal-receipt')).toContainText('已经保存');

  // A fresh boot reads the same stored split.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(lib.getByTestId('proposal-card').filter({ hasText: '调整学习集' }).getByTestId('proposal-item'))
    .toHaveAttribute('data-item-status', 'failed');
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});
