import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
// The fixtures are written by the Vault's own writers, not a second format.
// @ts-expect-error untyped plugin module
import { serializeFrontmatter } from '../../examples/native-vault/frontmatter.js';
// @ts-expect-error untyped plugin module
import { parseMarkdownDocument, revisionFor } from '../../examples/native-vault/vault.js';
// @ts-expect-error untyped plugin module
import { recordReviewContent } from '../../examples/native-vault/review-data.js';
// @ts-expect-error untyped plugin module
import { renderRoute, upsertLessonSummary } from '../../examples/native-vault/lesson-data.js';

/**
 * 学习星图 over synthetic Vault files: light comes only from real card
 * evaluations (knowledge) and real lesson summaries (courses), a parent reads
 * all of its leaves whatever is filtered, and new evidence written outside the
 * page reaches the map on the next projection read. The light theme reads it
 * as a 森林, the dark theme as the 深夜 sky.
 */
let sequence = 0;
function evaluate(path: string, content: string, outcomes: string[][]) {
  let document = parseMarkdownDocument(path, content, revisionFor(content));
  outcomes.forEach((outcome, index) => {
    const day = `2026-09-${String(10 + index * 4).padStart(2, '0')}`;
    const next = recordReviewContent(document, { id: `e2e-${++sequence}`, at: `${day}T08:00:00.000Z`, day, assessments: outcome.map((value, i) => ({ ability: `能力${i + 1}`, outcome: value })), note: '合成的评估记录。', actor: 'teacher', sessionId: 'e2e-lesson' });
    document = parseMarkdownDocument(path, next, revisionFor(next));
  });
  return document.content;
}

async function seed(vault: string) {
  const write = async (path: string, content: string) => { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), content); };
  const card = (path: string, parent: string) => serializeFrontmatter({ type: 'card', parent, tags: ['数学'] }) + `# ${(path.split('/').pop() ?? path).replace(/\.md$/, '')}\n`;
  const D = ['demonstrated'], N = ['needs_practice'], O = ['not_observed'];
  await write('专题/圆锥曲线.md', serializeFrontmatter({ type: 'topic', tags: ['数学'] }) + '# 圆锥曲线\n');
  const tree: Array<[string, string, string[][]]> = [
    ['卡片/椭圆.md', '专题/圆锥曲线.md', []], ['卡片/双曲线.md', '专题/圆锥曲线.md', []], ['卡片/抛物线.md', '专题/圆锥曲线.md', [D]],
    ['卡片/焦点与准线.md', '卡片/椭圆.md', [D, D, D]], ['卡片/标准方程.md', '卡片/椭圆.md', [D, D]], ['卡片/离心率.md', '卡片/椭圆.md', [N, D]], ['卡片/参数方程.md', '卡片/椭圆.md', [O]],
    ['卡片/渐近线.md', '卡片/双曲线.md', [D]], ['卡片/离心率范围.md', '卡片/双曲线.md', []],
  ];
  for (const [path, parent, outcomes] of tree) await write(path, evaluate(path, card(path, parent), outcomes));
  await write('锦囊/先画草图.md', serializeFrontmatter({ type: 'insight', parent: '专题/圆锥曲线.md' }) + '# 先画草图\n');
  await write('路线/圆锥曲线路线.md', renderRoute({ title: '圆锥曲线路线', nodes: [
    { id: 'n1', title: '定义与图像', materials: [], stage: '认识曲线', sessionId: 'e2e-session-a' },
    { id: 'n2', title: '标准方程课', parent: 'n1', materials: [], stage: '认识曲线', sessionId: 'e2e-session-b' },
    { id: 'n3', title: '离心率课', parent: 'n2', materials: [], stage: '几何性质' },
  ] }));
  await write('lesson_log/定义与图像.md', upsertLessonSummary('---\ntype: lesson-summary\n---\n# 定义与图像\n', {
    sessionId: 'e2e-session-a', learningSetRef: '数学/圆锥曲线', subjects: ['数学'], startedAt: '2026-09-18T09:00:00+08:00', throughAt: '2026-09-18T09:40:00+08:00', cutoff: 'msg-1', title: '定义与图像',
    body: '## 实际问题\n\n合成小结。\n\n## 下次从这里继续\n\n从方程继续。\n' }));
}

const star = (page: Page, name: string) => page.getByRole('button', { name: `图谱节点 ${name}`, exact: true });
const lesson = (page: Page, name: string) => page.getByRole('button', { name: `路线节点 ${name}`, exact: true });
/** Coarse sum of the map's colour; the canvas is the only place stars and trees are painted. */
const skySum = (page: Page) => page.locator('.nv-star-canvas').first().evaluate((canvas: HTMLCanvasElement) => {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0; for (let i = 0; i < data.length; i += 32) sum += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) + (data[i + 3] ?? 0); return sum;
});

test('the star map lights from real evidence, aggregates every leaf and follows new records', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = await startVaultIsolated();
  const vault = join(runtime.root, 'workspace/vault');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await seed(vault);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 8000 }); await later.click(); } catch { /* already acknowledged */ }
    const input = page.locator('[data-composer-input][contenteditable="true"]').last();
    await input.fill('打开资料'); await input.press('Enter');
    await page.getByRole('button', { name: '资料库', exact: true }).click();
    await page.getByRole('tab', { name: '图谱', exact: true }).click();
    const views = page.getByRole('group', { name: '图谱视图' });
    await views.getByRole('button', { name: '森林', exact: true }).click();
    const board = page.locator('.nv-star-board').first();
    await expect(page.getByRole('group', { name: '知识森林' })).toBeVisible();
    await expect(board).toHaveAttribute('data-sky', 'forest');

    // Evidence states: lit, unobserved (only not_observed), no evidence, outside mastery.
    await expect(star(page, '焦点与准线')).toHaveAttribute('data-state', 'lit');
    await expect(star(page, '参数方程')).toHaveAttribute('data-state', 'unobserved');
    await expect(star(page, '离心率范围')).toHaveAttribute('data-state', 'unobserved');
    await expect(star(page, '先画草图')).toHaveAttribute('data-state', 'unlinked');
    await expect(star(page, '椭圆')).toHaveAttribute('data-kind', 'parent');
    await expect(page.getByLabel('森林图例')).toContainText('不是考试分数');
    await expect(page.getByLabel('森林图例')).toContainText('土堆：尚未评估');
    // Each plot is named on its own sign; trees are named once zoomed in or pointed at.
    await expect(board.locator('.nv-star-group', { hasText: '圆锥曲线' })).toBeVisible();

    // The forest is painted and sways; reduced motion holds it still.
    await expect.poll(() => skySum(page)).toBeGreaterThan(0);
    const before = await skySum(page);
    await expect.poll(() => skySum(page)).not.toBe(before);

    // A parent reads every leaf below it, through intermediate cards.
    const details = page.getByRole('complementary', { name: '节点详情' });
    await star(page, '圆锥曲线').click();
    await expect(details.getByRole('region', { name: '生长' })).toContainText('已评估叶子5 / 7');
    await star(page, '椭圆').click();
    const reading = details.getByRole('region', { name: '生长' });
    await expect(reading).toContainText('已评估叶子3 / 4');
    await expect(reading).toContainText('整体掌握');

    // 结构 and 森林 share one selection.
    await views.getByRole('button', { name: '结构', exact: true }).click();
    await expect(star(page, '椭圆')).toHaveAttribute('aria-pressed', 'true');
    await views.getByRole('button', { name: '森林', exact: true }).click();
    await expect(star(page, '椭圆')).toHaveAttribute('aria-pressed', 'true');

    // Focusing a neighbourhood draws fewer stars but never changes a parent's light.
    await details.getByRole('button', { name: '以此为中心', exact: true }).click();
    await expect(star(page, '渐近线')).toHaveCount(0);
    await star(page, '圆锥曲线').click();
    await expect(details.getByRole('region', { name: '生长' })).toContainText('已评估叶子5 / 7');
    await page.getByRole('button', { name: '全局图谱', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: testInfo.outputPath('star-map-forest.png') });
    // The retired light-theme candidates are gone: the old browser key changes nothing.
    await page.evaluate(() => localStorage.setItem('notara-star-day', 'garden'));
    await views.getByRole('button', { name: '结构', exact: true }).click();
    await views.getByRole('button', { name: '森林', exact: true }).click();
    await expect(board).toHaveAttribute('data-sky', 'forest');
    await page.evaluate(() => localStorage.removeItem('notara-star-day'));

    // New evidence written outside the page lights the leaf and widens its parent.
    const parametric = join(vault, '卡片/参数方程.md');
    await writeFile(parametric, evaluate('卡片/参数方程.md', await readFile(parametric, 'utf8'), [['demonstrated']]));
    await page.evaluate(() => window.dispatchEvent(new Event('notara-vault-changed')));
    await expect(star(page, '参数方程')).toHaveAttribute('data-state', 'lit');
    await star(page, '椭圆').click();
    await expect(details.getByRole('region', { name: '生长' })).toContainText('已评估叶子4 / 4');

    // The dark theme swaps the same map to the night sky, live.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', /.*/);
    await expect(board).toHaveAttribute('data-sky', 'night');
    await expect(page.getByRole('group', { name: '知识星图' })).toBeVisible();
    await expect(views.getByRole('button', { name: '星图', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('星图图例')).toContainText('暗星：尚未评估');
    await expect(details.getByRole('region', { name: '星光' })).toContainText('已评估叶子4 / 4');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: testInfo.outputPath('star-map-night.png') });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await expect(board).toHaveAttribute('data-sky', 'forest');
    await views.getByRole('button', { name: '结构', exact: true }).click();
    await views.getByRole('button', { name: '森林', exact: true }).click();
    await page.waitForTimeout(300);
    const still = await skySum(page); await page.waitForTimeout(500);
    expect(await skySum(page)).toBe(still);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Courses light only from a saved summary; an opened classroom stays unlit.
    await page.getByRole('button', { name: '计划', exact: true }).click();
    await page.getByRole('tab', { name: '路线', exact: true }).click();
    const routeSelect = page.getByLabel('学习路线', { exact: true });
    if (await routeSelect.count()) await routeSelect.selectOption('路线/圆锥曲线路线.md');
    await page.getByRole('group', { name: '路线视图' }).getByRole('button', { name: '森林', exact: true }).click();
    await expect(page.getByRole('group', { name: '课程森林' })).toBeVisible();
    await expect(page.getByRole('group', { name: '课程森林' }).locator('.nv-star-group', { hasText: '认识曲线' })).toBeVisible();
    await expect(lesson(page, '定义与图像')).toHaveAttribute('data-state', 'lit');
    await expect(lesson(page, '标准方程课')).toHaveAttribute('data-state', 'opened');
    await expect(lesson(page, '离心率课')).toHaveAttribute('data-state', 'planned');
    await lesson(page, '定义与图像').click();
    const courseDetails = page.getByRole('complementary', { name: '课程详情' });
    await expect(courseDetails.getByRole('region', { name: '生长' })).toContainText('已种下银杏');
    await expect(courseDetails.getByRole('region', { name: '生长' })).toContainText('完成于');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: testInfo.outputPath('star-map-courses-forest.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.getByRole('group', { name: '课程星图' })).toBeVisible();
    await expect(courseDetails.getByRole('region', { name: '星光' })).toContainText('已点亮');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: testInfo.outputPath('star-map-courses-night.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    // 801px: the sky stays usable without horizontal overflow.
    await page.setViewportSize({ width: 801, height: 900 });
    await page.getByRole('button', { name: '资料库', exact: true }).click();
    await page.getByRole('tab', { name: '图谱', exact: true }).click();
    await expect(page.getByRole('group', { name: '知识森林' })).toBeVisible();
    const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('star-map-801.png') });
  } finally {
    await testInfo.attach('errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
    await runtime.stop();
  }
  expect(errors.filter(text => !/favicon|net::|downloadable font|MISSING_CREDENTIAL|API key/i.test(text))).toEqual([]);
});
