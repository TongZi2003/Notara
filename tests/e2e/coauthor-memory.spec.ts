/**
 * P7.2 one judgement about the student, edited by both writers.
 *
 * The record is created by the Host's own `note_memory` tool, driven by the
 * isolated test model from a real utterance the student really sent — so the
 * quote the panel shows is resolved provenance, not a seeded string. The
 * student's correction goes through the panel, the second writer is a real
 * `studyforgeMemory/edit`, and the conflict the editor shows is the Host's own
 * `version_conflict`. Editing the wording is not a new observation: the history
 * must not grow, and no second record may appear.
 *
 * The panel itself is the lesson's own entry (`lesson-memory` inside the right
 * bar's lesson panel), so this spec opens it the way the student does.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput, openRoot } from './fixtures/classroom.ts';
import type { MemoryView } from '@studyforge/contracts/memory';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
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

/**
 * Open the current student-facing memory page; it shares the same records and
 * editor as the lesson settings, without relying on the retired rightbar section.
 */
async function openMemory(page: Page): Promise<void> {
  await dismissNotices(page);
  await openRoot(page, '学情');
  await expect(page.getByTestId('memory-panel')).toBeVisible({ timeout: 15_000 });
}

/** One real observation: the student's own words first, then the Host's tool. */
async function noteOnce(page: Page, dsh: IsolatedRuntime): Promise<MemoryView> {
  await enterClassroom(page, dsh.authUrl);
  await sendInput(page, '遇到新题我会先自己试一遍，再对答案。');
  await sendInput(page, '[tool]' + JSON.stringify({
    name: 'note_memory',
    arguments: { kind: 'habit', title: '做新题的习惯', body: '遇到新题会先自己试一遍，再对答案。', evidenceRefs: ['E1'] },
  }));
  const client = await connectRuntime(dsh);
  await expect.poll(async () => {
    const list = await client.rpc<MemoryView[]>('studyforgeMemory/list', {});
    return list.ok ? list.value.length : -1;
  }, { timeout: 40_000 }).toBe(1);
  const list = await client.rpc<MemoryView[]>('studyforgeMemory/list', {});
  const first = list.ok ? list.value[0] : undefined;
  if (first === undefined) throw new Error('note_memory stored nothing');
  return first;
}

test('the student rewrites one judgement, keeps its evidence, and survives a conflict', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const created = await noteOnce(page, dsh);
  const client = await connectRuntime(dsh);

  await openMemory(page);
  const card = page.getByTestId('memory-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('memory-kind')).toHaveText('习惯');
  await expect(card.getByTestId('memory-body')).toContainText('再对答案');
  // The source is the student's real utterance, and it is readable in place.
  await expect(card.getByTestId('memory-basis-current')).toContainText('先自己试一遍');
  await page.screenshot({ path: testInfo.outputPath('memory-open.png'), fullPage: true });

  // Reading the panel wrote nothing: still one record, still one observation.
  const afterRead = await client.rpc<MemoryView[]>('studyforgeMemory/list', {});
  expect(afterRead.ok ? afterRead.value.length : -1).toBe(1);
  expect(afterRead.ok ? afterRead.value[0]?.history.length : -1).toBe(1);

  // The student's own wording: same identity, same evidence, no new observation.
  await card.getByTestId('memory-edit').click();
  await expect(page.getByTestId('memory-editor')).toBeVisible();
  await page.getByTestId('memory-editor-body').fill('遇到新题会先自己试一遍，再对答案；卡住时会先写下已知条件。');
  await page.getByTestId('memory-editor-save').click();
  await expect(page.getByTestId('memory-editor')).toHaveCount(0);
  await expect(page.getByTestId('memory-body')).toContainText('先写下已知条件');
  const afterStudent = await client.rpc<MemoryView>('studyforgeMemory/read', { input: { target: created.ref } });
  expect(afterStudent.ok ? afterStudent.value.history.length : -1).toBe(1);
  const studentRevision = afterStudent.ok ? afterStudent.value.revision : 0;
  expect(studentRevision).toBeGreaterThan(created.revision);

  // A second writer corrects the same record while the student has it open.
  await page.getByTestId('memory-card').getByTestId('memory-edit').click();
  await expect(page.getByTestId('memory-editor')).toBeVisible();
  const other = await client.rpc<MemoryView>('studyforgeMemory/edit', { input: {
    operationId: crypto.randomUUID(), target: created.ref, expectedVersion: studentRevision,
    edit: { content: { kind: 'habit', title: '做新题的习惯', body: '老师补一句：卡住时会把条件写下来。' } },
  } });
  expect(other.ok).toBe(true);

  await page.getByTestId('memory-editor-body').fill('遇到新题先自己试，卡住就写条件；两件事我都做。');
  await page.getByTestId('memory-editor-save').click();
  await expect(page.getByTestId('memory-editor-conflict')).toBeVisible();
  await expect(page.getByTestId('memory-editor-latest')).toContainText('老师补一句');
  // The draft survives the refusal instead of being replaced by the newer text.
  await expect(page.getByTestId('memory-editor-body')).toHaveValue('遇到新题先自己试，卡住就写条件；两件事我都做。');
  await page.screenshot({ path: testInfo.outputPath('memory-conflict.png'), fullPage: true });

  await page.getByTestId('memory-editor-rebase').click();
  await page.getByTestId('memory-editor-save').click();
  await expect(page.getByTestId('memory-editor')).toHaveCount(0);

  // One record, the student's wording, the original evidence, and no new observation.
  const final = await client.rpc<MemoryView>('studyforgeMemory/read', { input: { target: created.ref } });
  expect(final.ok ? final.value.ref : '').toBe(created.ref);
  expect(final.ok ? final.value.content.body : '').toBe('遇到新题先自己试，卡住就写条件；两件事我都做。');
  expect(final.ok ? final.value.history.length : -1).toBe(1);
  expect(final.ok ? final.value.basis.current : []).toHaveLength(1);
  const list = await client.rpc<MemoryView[]>('studyforgeMemory/list', {});
  expect(list.ok ? list.value.length : -1).toBe(1);

  // A fresh boot reads the same single judgement.
  await enterClassroom(page, dsh.authUrl);
  await openMemory(page);
  await expect(page.getByTestId('memory-card')).toHaveCount(1);
  await expect(page.getByTestId('memory-body')).toContainText('两件事我都做');
  expect(errors).toEqual([]);
});
