/**
 * P5.5/P5.7 a frozen card version, opened the way a lesson really opens it.
 *
 * The lesson's own first material can name an exact card version, and the
 * native card-resource tab (`materials/CardResource.tsx`) mounts that version
 * read-only: its own text, no edit entry, and no newer-change projection — the
 * later edits belong to the current card and must not leak a newer answer into
 * a historical view.
 *
 * The version is pinned through the real course metadata Remote and opened by
 * the lesson itself, so nothing here depends on a test-only mount.
 */
import { test, expect, enterClassroom, sendInput, openCards } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CardView } from '@studyforge/contracts/cards';
import type { CourseView } from '@studyforge/contracts/courses';

const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('a frozen version shows its own text and offers no edit or newer redline', async ({ page, classroom }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, classroom.authUrl);
  // One real turn opens the lesson; a blank session has no lesson surfaces yet.
  await sendInput(page, '请讲解一次函数');
  const client = await connectRuntime(classroom);

  let sessionId = '';
  await expect.poll(async () => {
    const listed = await client.rpc<SessionListValue>('session/list', { _request: {} });
    sessionId = listed.ok ? listed.value.items.find(item => !item.blank && item.origin !== 'subagent')?.sessionId ?? '' : '';
    return sessionId;
  }, { timeout: 40_000 }).not.toBe('');

  // Two real versions of one card: create v1, then edit the face into v2.
  await openCards(page);
  await page.getByTestId('card-browser-create').click();
  await page.getByTestId('card-editor-title').fill('固定版本卡片');
  await page.getByTestId('card-editor-front').fill('第一版卡面：求顶点。');
  await page.getByTestId('card-editor-section-add').click();
  await page.getByTestId('card-editor-section-heading').fill('解法');
  await page.getByTestId('card-editor-section-body').fill('第一版解法。');
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('固定版本卡片');
  await page.getByTestId('card-detail-edit').click();
  await page.getByTestId('card-editor-title').fill('第二版卡片标题');
  await page.getByTestId('card-editor-front').fill('第二版卡面：求顶点与对称轴。');
  await page.getByTestId('card-editor-section-body').fill('第二版解法。');
  await page.getByTestId('card-editor-save').click();
  await expect(page.getByTestId('card-detail-front')).toContainText('第二版卡面');

  const card = value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}))[0];
  expect(card?.version).toBe(2);
  const target = card?.ref ?? '';

  // Pin the lesson's own first material to v1 through the real metadata Remote.
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  value(await client.rpc<CourseView>('studyforgeCourses/update', { input: {
    sessionId, operationId: crypto.randomUUID(), expectedVersion: course.version,
    patch: { lessonMaterials: { materials: [{ kind: 'card', cardRef: target, cardVersion: 1 }] } },
  } }));

  // Re-entering opens the map. The card node opens its pinned revision here.
  await enterClassroom(page, classroom.authUrl);
  const pinned = page.getByTestId('lesson-materials-map').locator('[data-kind="card"]').filter({ hasText: '本节课安排' });
  await expect(pinned).toContainText('固定版本卡片');
  await expect(pinned).not.toContainText('第二版卡片标题');
  await pinned.getByTestId('lesson-resource-open').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('固定版本卡片');
  await expect(page.getByTestId('card-detail-fixed')).toBeVisible();
  await expect(page.getByTestId('card-detail-front')).toContainText('第一版卡面');
  await expect(page.getByTestId('card-detail-edit')).toHaveCount(0);
  await expect(page.getByTestId('card-detail-changes')).toHaveCount(0);
  await page.getByTestId('card-detail-reveal').click();
  await expect(page.getByTestId('card-detail-back-body')).toContainText('第一版解法');
  await expect(page.getByTestId('card-detail-back-body')).not.toContainText('第二版解法');
  await page.screenshot({ path: testInfo.outputPath('card-fixed-v1.png'), fullPage: true });

  expect(errors).toEqual([]);
});
