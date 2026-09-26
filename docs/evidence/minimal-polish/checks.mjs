// Computed-style assertions for the minimal-theme polish, run against the real
// built client (no --css layer). Reads the live auth URL from
// .runtime/modern-preview.json; results land in <out>/checks.json.
// Usage: node docs/evidence/minimal-polish/checks.mjs <output-dir>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const outDir = resolve(process.argv[2] ?? 'docs/evidence/minimal-polish/after');
await mkdir(outDir, { recursive: true });
const { authUrl } = JSON.parse(await readFile('.runtime/modern-preview.json', 'utf8'));
if (!authUrl) throw new Error('modern-preview.json missing authUrl — is the isolated vault running?');

const results = [];
const consoleLog = { errors: [], pageerrors: [] };
const check = (name, actual, expected, pass) => {
  results.push({ name, expected, actual, pass: !!pass });
  console.log(pass ? 'PASS' : 'FAIL', name, `(${JSON.stringify(actual)})`);
};
const css = (page, selector, prop) => page.evaluate(([sel, p]) => {
  const el = document.querySelector(sel);
  return el ? getComputedStyle(el)[p] : null;
}, [selector, prop]);
const step = async (label, fn) => {
  try { await fn(); } catch (error) {
    const lines = String(error?.message ?? error).split('\n').map(l => l.trim()).filter(Boolean);
    const detail = lines.find(l => l.startsWith('waiting for')) ?? lines[0];
    results.push({ name: label, pass: false, error: detail });
    console.log('FAIL', label, '-', detail);
  }
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
page.on('pageerror', error => consoleLog.pageerrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleLog.errors.push(message.text()); });

await page.goto(authUrl);
for (const name of ['Configure later', 'Continue']) {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.isVisible().catch(() => false)) { await button.click(); break; }
}
await page.locator('aside.nv-sidebar').waitFor({ timeout: 30_000 });
await page.locator('.nv-home-task, .nv-home-empty').first().waitFor({ timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(800);

// Shell: the full-height divider beside the floating sidebar card is gone; the
// card itself carries one XL-radius boundary.
await step('shell', async () => {
  const border = await css(page, '.pI_x6G_sidebarCol', 'borderRightColor');
  check('sidebar column divider transparent', border, 'rgba(0, 0, 0, 0)', border === 'rgba(0, 0, 0, 0)' || border === 'transparent');
  const radius = await css(page, '.nv-sidebar', 'borderRadius');
  check('sidebar radius 20px', radius, '20px', radius === '20px');
  const newLesson = await css(page, '.nv-new-lesson', 'backgroundColor');
  check('new-lesson bg (button-info-fill)', newLesson, 'rgb(240, 241, 243)', newLesson === 'rgb(240, 241, 243)');
  const rmd = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--nv-r-md').trim());
  check('--nv-r-md token', rmd, '10px', rmd === '10px');
});

// 资料库 · 卡片: segmented tabs, card radius, field chevron, link row.
await step('cards page', async () => {
  await page.locator('aside.nv-sidebar nav').getByRole('button', { name: '资料库', exact: true }).click();
  await page.getByRole('tablist', { name: '资料库视图' }).getByRole('tab', { name: '卡片', exact: true }).click();
  await page.locator('.nv-card').first().waitFor({ timeout: 15_000 });
  const selected = page.locator('.nv-shell-tabs button[aria-selected=true]').first();
  check('shell tab selected bg', await css(page, '.nv-shell-tabs button[aria-selected=true]', 'backgroundColor'), 'rgb(255, 255, 255)', (await selected.evaluate(el => getComputedStyle(el).backgroundColor)) === 'rgb(255, 255, 255)');
  const shadow = await selected.evaluate(el => getComputedStyle(el).boxShadow);
  check('shell tab selected shadow', shadow, 'non-none', shadow !== 'none');
  check('card radius 14px', await css(page, '.nv-card', 'borderRadius'), '14px', (await css(page, '.nv-card', 'borderRadius')) === '14px');
  const selectBg = await css(page, '.nv-card-filters select, .nv-view-top select', 'backgroundImage');
  check('select chevron svg', selectBg && selectBg.slice(0, 24), 'contains svg', !!selectBg && selectBg.includes('svg'));
  check('card-source flex', await css(page, '.nv-card-source', 'display'), 'flex', (await css(page, '.nv-card-source', 'display')) === 'flex');
  const link = page.locator('.nv-card-source .nv-link').first();
  const before = await link.evaluate(el => getComputedStyle(el).textDecorationLine);
  check('card-source link underline off', before, 'none', before === 'none');
  await link.hover();
  const after = await link.evaluate(el => getComputedStyle(el).textDecorationLine);
  check('card-source link underline on hover', after, 'underline', after === 'underline');
  const chipFont = await css(page, '.nv-card-filters button', 'fontSize');
  check('card-filter chip font-size', chipFont, '12px', chipFont === '12px');
});

// Graph context menu: .nv-menu radius.
await step('graph menu', async () => {
  await page.getByRole('tablist', { name: '资料库视图' }).getByRole('tab', { name: '图谱', exact: true }).click();
  const node = page.getByRole('button', { name: /^图谱节点/, exact: false }).first();
  await node.waitFor({ timeout: 15_000 });
  await node.click({ button: 'right' });
  await page.locator('.nv-menu').waitFor({ timeout: 8_000 });
  check('menu radius 14px', await css(page, '.nv-menu', 'borderRadius'), '14px', (await css(page, '.nv-menu', 'borderRadius')) === '14px');
  const item = page.locator('.nv-menu .nv-quiet').first();
  const itemBg = await item.evaluate(el => getComputedStyle(el).backgroundColor);
  const itemJustify = await item.evaluate(el => getComputedStyle(el).justifyContent);
  check('menu item bg transparent', itemBg, 'rgba(0, 0, 0, 0)', itemBg === 'rgba(0, 0, 0, 0)' || itemBg === 'transparent');
  check('menu item justify flex-start', itemJustify, 'flex-start', itemJustify === 'flex-start');
  await page.keyboard.press('Escape');
});

// Classroom: user bubble colour + the 对话/白板/教室 segmented thumb, plus a
// .nv-quiet hover change. A session exists from the capture run; if not, send
// one message from Home to create it.
await step('classroom', async () => {
  const row = page.locator('.nv-session-row').first();
  if (await row.isVisible().catch(() => false)) await row.click();
  else {
    await page.locator('aside.nv-sidebar nav').getByRole('button', { name: '今日', exact: true }).click();
    await page.locator('.nv-home').waitFor({ timeout: 15_000 });
    const composer = page.locator('[data-composer-input]').last();
    await composer.click();
    await page.keyboard.insertText('你好');
    await composer.press('Enter');
  }
  const bubble = page.locator('.Sixlwa_bubble').first();
  await bubble.waitFor({ timeout: 15_000 });
  check('user bubble bg', await bubble.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(243, 244, 246)', (await bubble.evaluate(el => getComputedStyle(el).backgroundColor)) === 'rgb(243, 244, 246)');
  const tab = page.locator('.nv-class-views button[aria-selected=true]').first();
  check('class tab selected bg', await tab.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', (await tab.evaluate(el => getComputedStyle(el).backgroundColor)) === 'rgb(255, 255, 255)');
  const tabShadow = await tab.evaluate(el => getComputedStyle(el).boxShadow);
  check('class tab selected shadow', tabShadow, 'non-none', tabShadow !== 'none');
});

// 复习: quiet-button hover change + disabled 保存评估 opacity.
await step('review', async () => {
  await page.locator('aside.nv-sidebar nav').getByRole('button', { name: '计划', exact: true }).click();
  await page.getByRole('tablist', { name: '计划视图' }).getByRole('tab', { name: '复习', exact: true }).click();
  await page.locator('.nv-review-row').first().click({ timeout: 15_000 });
  const save = page.getByRole('button', { name: '保存评估', exact: true });
  await save.waitFor({ timeout: 15_000 });
  check('保存评估 disabled opacity', await save.evaluate(el => getComputedStyle(el).opacity), '0.45', (await save.evaluate(el => getComputedStyle(el).opacity)) === '0.45');
  const quiet = page.getByRole('button', { name: '带入对话复习', exact: true });
  const idle = await quiet.evaluate(el => getComputedStyle(el).backgroundColor);
  await quiet.hover();
  const hovered = await quiet.evaluate(el => getComputedStyle(el).backgroundColor);
  check('nv-quiet hover changes bg', `${idle} -> ${hovered}`, 'different', idle !== hovered);
});

// Dark: body carries data-ds-dark-theme, info-fill flips, the home composer
// backdrop is transparent.
await step('dark', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(1200);
  const dark = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'));
  check('body[data-ds-dark-theme]', dark, 'true', dark === true);
  await page.locator('aside.nv-sidebar nav').getByRole('button', { name: '今日', exact: true }).click();
  await page.locator('.nv-home').waitFor({ timeout: 15_000 });
  const newLesson = await css(page, '.nv-new-lesson', 'backgroundColor');
  check('new-lesson bg dark', newLesson, 'rgb(43, 49, 58)', newLesson === 'rgb(43, 49, 58)');
  const homeRoot = await css(page, '.nv-home .wSkVaW_root', 'backgroundColor');
  check('dark home composer backdrop transparent', homeRoot, 'rgba(0, 0, 0, 0)', homeRoot === 'rgba(0, 0, 0, 0)' || homeRoot === 'transparent');
});

check('console errors', consoleLog.errors.length, 0, consoleLog.errors.length === 0);
check('page errors', consoleLog.pageerrors.length, 0, consoleLog.pageerrors.length === 0);

const failed = results.filter(r => !r.pass);
await writeFile(join(outDir, 'checks.json'), JSON.stringify({ pass: failed.length === 0, results, console: consoleLog }, null, 2) + '\n');
await browser.close();
console.log(failed.length ? `FAILED: ${failed.length} check(s)` : 'all checks passed', '->', join(outDir, 'checks.json'));
process.exit(failed.length ? 1 : 0);
