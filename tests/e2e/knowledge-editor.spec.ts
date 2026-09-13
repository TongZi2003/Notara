/**
 * P5.2/P5.5 one private knowledge note, edited by two writers.
 *
 * The note is written through the Host's own `noteMethod`, the student's edit
 * goes through the real editor, and the second writer is a real `reviseMethod`
 * on the same target — so the conflict the editor shows is the Host's own
 * `version_conflict`, not a scripted one. Collecting or editing knowledge never
 * copies it into a card and never writes a review row.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, openRoot } from './fixtures/classroom.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { LearningRecord } from '@studyforge/domain/learning-records';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated();
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

async function dismissNotices(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count() === 0) continue;
    try { await button.click({ timeout: 2_000 }); } catch { /* it was already gone */ }
  }
}

async function openCards(page: Page): Promise<void> {
  await dismissNotices(page);
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '整理与复习', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

/** The Host writes the first version the way the tool would; the UI never fakes one. */
async function noteOnce(dsh: IsolatedRuntime): Promise<KnowledgeView> {
  const client = await connectRuntime(dsh);
  const noted = await client.rpc<KnowledgeView>('studyforgeLearning/noteMethod', { input: {
    operationId: crypto.randomUUID(),
    content: { title: '分母不能为零', body: '先把分母不为零写出来。', tags: ['代数'], links: [], publicSources: [] },
  } });
  if (!noted.ok) throw new Error('noteMethod failed: ' + noted.error.message);
  return noted.value;
}

test('knowledge keeps one identity while the student and the teacher both revise it', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  const first = await noteOnce(dsh);
  const client = await connectRuntime(dsh);

  await openCards(page);
  const row = page.getByTestId('card-row').filter({ hasText: '分母不能为零' });
  await expect(row).toHaveCount(1);
  await row.getByTestId('card-row-open').click();
  await expect(page.getByTestId('knowledge-editor')).toBeVisible();
  await expect(page.getByTestId('knowledge-editor-body')).toHaveValue('先把分母不为零写出来。');
  await page.screenshot({ path: testInfo.outputPath('knowledge-open.png'), fullPage: true });

  // The student's own edit: same record, new body, preview renders it.
  await page.getByTestId('knowledge-editor-body').fill('先把分母不为零写出来。\n再谈约分。');
  await page.getByTestId('knowledge-editor-save').click();
  await expect(page.getByTestId('knowledge-editor')).toHaveCount(0);
  await expect.poll(async () => {
    const read = await client.rpc<KnowledgeView>('studyforgeLearning/method', { input: { target: first.ref } });
    return read.ok ? read.value.content.body : '<read failed>';
  }, { timeout: 20_000 }).toContain('再谈约分');
  const afterStudent = await client.rpc<KnowledgeView>('studyforgeLearning/method', { input: { target: first.ref } });
  const studentVersion = afterStudent.ok ? afterStudent.value.version : 0;

  // A second writer moves the same record while the editor is open.
  await row.getByTestId('card-row-open').click();
  await expect(page.getByTestId('knowledge-editor')).toBeVisible();
  const other = await client.rpc<KnowledgeView>('studyforgeLearning/reviseMethod', { input: {
    operationId: crypto.randomUUID(), target: first.ref, expectedVersion: studentVersion,
    patch: { body: '先把分母不为零写出来。\n老师补一句：条件先写在最上面。' },
  } });
  expect(other.ok).toBe(true);

  await page.getByTestId('knowledge-editor-body').fill('先把分母不为零写出来，条件写在最上面。');
  await page.getByTestId('knowledge-editor-save').click();
  await expect(page.getByTestId('knowledge-editor-conflict')).toBeVisible();
  await expect(page.getByTestId('knowledge-editor-latest')).toContainText('老师补一句');
  // The draft is kept, not silently replaced by the newer version.
  await expect(page.getByTestId('knowledge-editor-body')).toHaveValue('先把分母不为零写出来，条件写在最上面。');
  await page.screenshot({ path: testInfo.outputPath('knowledge-conflict.png'), fullPage: true });

  await page.getByTestId('knowledge-editor-rebase').click();
  await page.getByTestId('knowledge-editor-save').click();
  await expect(page.getByTestId('knowledge-editor')).toHaveCount(0);

  // One identity, the student's text, and no card or record invented on the way.
  const final = await client.rpc<KnowledgeView>('studyforgeLearning/method', { input: { target: first.ref } });
  expect(final.ok ? final.value.ref : '').toBe(first.ref);
  expect(final.ok ? final.value.content.body : '').toBe('先把分母不为零写出来，条件写在最上面。');
  const knowledge = await client.rpc<KnowledgeView[]>('studyforgeLearning/knowledge', {});
  expect(knowledge.ok ? knowledge.value.length : -1).toBe(1);
  const cards = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  expect(cards.ok ? cards.value : []).toEqual([]);
  const records = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
  expect(records.ok ? records.value : []).toEqual([]);

  // A fresh boot reads the same single note.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(page.getByTestId('card-row').filter({ hasText: '分母不能为零' })).toHaveCount(1);
  await page.getByTestId('card-row').filter({ hasText: '分母不能为零' }).getByTestId('card-row-open').click();
  await expect(page.getByTestId('knowledge-editor-body')).toHaveValue('先把分母不为零写出来，条件写在最上面。');
  expect(errors).toEqual([]);
});

/**
 * P5.2 removing one knowledge note is its own decision, and it never takes a
 * card or a learning record with it. The card and the record below are written
 * by the real Host calls; the delete itself goes through the student's own
 * confirmation in the editor.
 */
test('deleting one knowledge note leaves the related card and the learning records', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  const client = await connectRuntime(dsh);

  const created = await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: crypto.randomUUID(),
    content: {
      title: '分母条件的题', presentation: 'problem', front: '分式先看什么？',
      sections: [{ heading: '解法', body: '先把分母不为零写出来。' }], notes: '', sources: [], tags: [], links: [],
    },
  } });
  expect(created.ok).toBe(true);
  const cardRef = created.ok ? created.value.ref : '';
  const reviewed = await client.rpc<unknown>('studyforgeLearning/review', { input: {
    operationId: crypto.randomUUID(), target: cardRef, mark: '牢',
  } });
  expect(reviewed.ok).toBe(true);

  const noted = await client.rpc<KnowledgeView>('studyforgeLearning/noteMethod', { input: {
    operationId: crypto.randomUUID(),
    content: { title: '分母不能为零', body: '先把分母不为零写出来。', tags: ['代数'], links: [cardRef], publicSources: [] },
  } });
  expect(noted.ok).toBe(true);
  const knowledgeRef = noted.ok ? noted.value.ref : '';
  const knowledgeVersion = noted.ok ? noted.value.version : 0;

  await openCards(page);
  const noteRow = page.getByTestId('card-row').filter({ hasText: '分母不能为零' });
  await expect(noteRow).toHaveCount(1);
  await noteRow.getByTestId('card-row-open').click();
  await expect(page.getByTestId('knowledge-editor')).toBeVisible();

  // The student sees what this deletes — and what it does not — before it happens.
  await page.getByTestId('knowledge-editor-delete').click();
  await expect(page.getByTestId('knowledge-editor-delete-confirm')).toBeVisible();
  await expect(page.getByTestId('knowledge-editor-delete-confirm')).toContainText('卡还在');
  await expect(page.getByTestId('knowledge-editor-delete-confirm')).toContainText('学习记录也还在');
  await page.screenshot({ path: testInfo.outputPath('knowledge-delete-confirm.png'), fullPage: true });

  // 先不删 really backs out: nothing is written and the note is still listed.
  await page.getByTestId('knowledge-editor-delete-no').click();
  await expect(page.getByTestId('knowledge-editor-delete-confirm')).toHaveCount(0);
  const stillThere = await client.rpc<KnowledgeView>('studyforgeLearning/method', { input: { target: knowledgeRef } });
  expect(stillThere.ok).toBe(true);

  await page.getByTestId('knowledge-editor-delete').click();
  await page.getByTestId('knowledge-editor-delete-yes').click();
  await expect(page.getByTestId('knowledge-editor')).toHaveCount(0);
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(1);
  await expect(page.getByTestId('card-row').filter({ hasText: '分母不能为零' })).toHaveCount(0);
  await expect(page.getByTestId('card-row').filter({ hasText: '分母条件的题' })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('knowledge-after-delete.png'), fullPage: true });

  // The note is gone from the current list, its old version is still readable,
  // and the card and the review record were never part of the delete.
  const gone = await client.rpc<KnowledgeView>('studyforgeLearning/method', { input: { target: knowledgeRef } });
  expect(gone.ok).toBe(false);
  const history = await client.rpc<KnowledgeView>('studyforgeLearning/method', { input: { target: knowledgeRef, version: knowledgeVersion } });
  expect(history.ok ? history.value.content.title : '').toBe('分母不能为零');
  const knowledge = await client.rpc<KnowledgeView[]>('studyforgeLearning/knowledge', {});
  expect(knowledge.ok ? knowledge.value : ['<read failed>']).toEqual([]);
  const cards = await client.rpc<CardView[]>('studyforgeLearning/cards', {});
  expect(cards.ok ? cards.value.map(card => card.ref) : []).toEqual([cardRef]);
  const records = await client.rpc<LearningRecord[]>('studyforgeLearning/records', {});
  expect(records.ok ? records.value.length : -1).toBe(1);

  // A fresh boot reads the same three facts.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(page.getByTestId('card-list').getByTestId('card-row')).toHaveCount(1);
  await expect(page.getByTestId('card-row').filter({ hasText: '分母条件的题' })).toHaveCount(1);
  expect(errors).toEqual([]);
});
