/**
 * P6.4 one lesson-settings proposal, edited by the student.
 *
 * The teacher's draft is not only prose: it can carry the lesson's material
 * list, its learning set and its teaching configuration. Saving the student's
 * own version therefore starts from what the teacher really proposed — a form
 * that rebuilt the patch from its own fields would silently drop the materials
 * and the learning set. Clearing a requirement or a focus is a real edit (the
 * schema carries `''`), while 教学方式 left empty means "this proposal does not
 * change it".
 *
 * Everything here is the real path: the Host's `read_lesson` and
 * `propose_lesson_settings` tools through the test model, the real proposal
 * store, the real course metadata, and the Host's own teaching choices.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput, openRoot } from './fixtures/classroom.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { CourseView } from '@studyforge/contracts/courses';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { SetView } from '@studyforge/contracts/sets';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { TeachingChoice } from '@studyforge/contracts/teaching';

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

async function openCards(page: Page): Promise<void> {
  await dismissNotices(page);
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '卡片与笔记', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

test('the student edits a lesson-settings draft without dropping what the teacher proposed', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  // One real turn opens the learning lesson the teacher will propose against.
  await sendInput(page, '请讲解一次函数');
  const client = await connectRuntime(dsh);

  let sessionId = '';
  await expect.poll(async () => {
    const listed = await client.rpc<SessionListValue>('session/list', { _request: {} });
    sessionId = listed.ok ? listed.value.items.find(item => !item.blank && item.origin !== 'subagent')?.sessionId ?? '' : '';
    return sessionId;
  }, { timeout: 40_000 }).not.toBe('');

  // A real card and a real learning set, so the proposal names objects the Host has.
  const card = await client.rpc<CardView>('studyforgeLearning/createCard', { input: {
    operationId: crypto.randomUUID(),
    content: { title: '定义域卡片', presentation: 'problem', front: '分式先看什么？',
      sections: [{ heading: '解法', body: '先把分母不为零写出来。' }], notes: '', sources: [], tags: [], links: [] },
  } });
  expect(card.ok).toBe(true);
  const cardRef = card.ok ? card.value.ref : '';
  const set = await client.rpc<SetView>('studyforgeOrganization/createSet', { input: {
    operationId: crypto.randomUUID(), set: { name: '一次函数' },
  } });
  expect(set.ok).toBe(true);
  const setRef = set.ok ? set.value.ref : '';
  const choices = await client.rpc<TeachingChoice[]>('studyforgeTeaching/choices', {});
  expect(choices.ok).toBe(true);
  const offered = choices.ok ? choices.value : [];
  const chosen = offered.find(choice => choice.id !== 'socratic') ?? offered[0];

  // The teacher reads this lesson, then proposes materials + requirements + focus.
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'read_lesson', arguments: {} }));
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'propose_lesson_settings', arguments: {
    lessonMaterials: { materials: [{ kind: 'card', cardRef, cardVersion: 1 }] },
    learningSetRef: setRef,
    temporaryInstructions: '先复习定义域。',
    stance: '看清定义域',
    archived: true,
  } }));
  await expect.poll(async () => {
    const list = await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} });
    return list.ok ? list.value.length : -1;
  }, { timeout: 40_000 }).toBe(1);

  await openCards(page);
  const lib = page.getByTestId('studyforge-page-studyforge.cards');
  const item = lib.getByTestId('proposal-item');
  await expect(item).toHaveCount(1);
  await expect(lib.getByTestId('proposal-lesson-materials')).toContainText('默认打开');
  await expect(lib.getByTestId('proposal-lesson-materials')).not.toContainText('名称暂未读到');
  await expect(lib.getByTestId('proposal-lesson-set')).toContainText('学习集');
  await expect(lib.getByTestId('proposal-lesson-archived')).toContainText('归档');
  await page.screenshot({ path: testInfo.outputPath('lesson-proposal.png'), fullPage: true });

  // The student's own version: the teaching choice comes from the Host's real
  // list, and both prose fields are cleared on purpose.
  await lib.getByTestId('proposal-edit').click();
  const editor = lib.getByTestId('organization-draft-editor');
  await expect(editor).toHaveAttribute('data-draft-kind', 'lesson-edit').catch(async error => {
    await testInfo.attach('page-errors.json', { body: JSON.stringify(errors), contentType: 'application/json' });
    throw new Error('Lesson editor did not mount; browser errors: ' + JSON.stringify(errors), { cause: error });
  });
  await expect(editor.getByTestId('draft-lesson-teaching')).toHaveValue('');
  await expect(editor.getByTestId('draft-lesson-teaching').locator('option', { hasText: chosen?.title ?? '' })).toHaveCount(1);
  await editor.getByTestId('draft-lesson-teaching').selectOption(chosen?.id ?? '');
  await editor.getByTestId('draft-lesson-instructions').fill('');
  await editor.getByTestId('draft-lesson-stance').fill('');
  await page.screenshot({ path: testInfo.outputPath('lesson-draft-cleared.png'), fullPage: true });
  await editor.getByTestId('draft-save').click();
  await expect(editor).toHaveCount(0);

  // Saving the draft is not saving the lesson: the proposal now carries the
  // student's words *and* everything the teacher proposed alongside them.
  await expect.poll(async () => {
    const list = await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} });
    const row = list.ok ? list.value[0] : undefined;
    const effect = row?.items[0]?.draft.effect;
    return effect?.kind === 'lesson-edit' ? JSON.stringify(effect.patch) : '';
  }, { timeout: 20_000 }).toContain('"learningSetRef"');
  const draft = await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} });
  const patch = draft.ok ? draft.value[0]?.items[0]?.draft.effect : undefined;
  expect(patch?.kind === 'lesson-edit' ? patch.patch : {}).toMatchObject({
    learningSetRef: setRef, temporaryInstructions: '', stance: '', teachingRef: chosen?.id ?? '',
    lessonMaterials: { materials: [{ kind: 'card', cardRef, cardVersion: 1 }] },
  });

  // Confirming writes that one version onto the same lesson.
  await lib.getByTestId('proposal-confirm').click();
  await expect.poll(async () => {
    const course = await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } });
    const data = course.ok ? course.value.data : undefined;
    return data === undefined ? '' : `${data.teachingRef ?? ''}|${data.temporaryInstructions ?? ''}|${data.stance ?? ''}|${data.learningSetRef ?? ''}|${data.lessonMaterials.materials.length}`;
  }, { timeout: 20_000 }).toBe(`${chosen?.id ?? ''}|||${setRef}|1`);
  await expect(lib.getByTestId('proposal-item-status')).toHaveText('已经保存');
  expect(errors).toEqual([]);
});
