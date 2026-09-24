// Browser acceptance for docs/ui/notara-frontend-prototype.html (modern + notebook styles).
// Serve the repository root over HTTP (the notebook face loads from packages/client/assets), then:
//   node docs/evidence/frontend-redesign/verify-prototype.mjs http://127.0.0.1:<port>
// Playwright resolves from this checkout; PLAYWRIGHT_FROM=<package.json of another checkout with the
// same locked version> is only for a worktree without node_modules.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM ?? new URL('../../../package.json', import.meta.url))('playwright');
const BASE = process.argv[2];
if (!BASE) throw new Error('base url required');
const OUT = new URL('./', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [], problems = [], shots = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, ...(detail ? { detail: String(detail) } : {}) }); if (!ok) console.log('FAIL', name, detail); };
const browser = await chromium.launch();

async function open(style, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  const tag = `[${style} ${viewport.width}]`;
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`${tag} console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('requestfailed', r => problems.push(`${tag} requestfailed: ${r.url()}`));
  page.on('response', r => { if (r.status() >= 400) problems.push(`${tag} http ${r.status()}: ${r.url()}`); });
  await page.goto(`${BASE}/docs/ui/notara-frontend-prototype.html${style === 'notebook' ? '?style=notebook' : ''}#/today`);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
// Transient toasts are asserted where they appear; hide them so a screenshot shows the page itself.
const shot = async (page, name) => { await page.evaluate(() => document.getElementById('toast')?.setAttribute('hidden', '')); await page.waitForTimeout(150); await page.screenshot({ path: OUT + name + '.png' }); shots.push(name + '.png'); };
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const nav = (page, text) => page.locator('.nav-row', { hasText: text }).click();

async function desktop(style) {
  const S = style, { ctx, page } = await open(style);
  check(`${S}: data-sf-style`, await page.evaluate(() => document.documentElement.dataset.sfStyle) === style);
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check(`${S}: body font family`, style === 'notebook' ? font.includes('SF WenKai') : !font.includes('WenKai'), font);
  const loaded = await page.evaluate(() => [...document.fonts].some(f => f.family.includes('SF WenKai') && f.status === 'loaded'));
  check(style === 'notebook' ? `${S}: WenKai face loaded` : `${S}: WenKai not downloaded`, style === 'notebook' ? loaded : !loaded);

  // 今日
  check(`${S}: today heading`, await page.getByRole('heading', { name: '今天想学点什么？' }).isVisible());
  check(`${S}: due count`, (await page.getByRole('region', { name: '今天要复习' }).locator('.stat b').first().textContent()) === '4');
  check(`${S}: today lesson`, await page.getByRole('region', { name: '今天的课' }).getByText('焦点弦与弦长').isVisible());
  check(`${S}: honest route note`, await page.getByText('进度只统计开课与小结，不代表已经掌握。').isVisible());
  check(`${S}: sidebar nav count`, (await page.locator('.nav-count').textContent()) === '4');
  check(`${S}: sidebar lesson rows fit`, await page.evaluate(() => { const list = document.querySelector('.side-lessons'); return list.scrollWidth <= list.clientWidth && [...list.querySelectorAll('.lesson-row time')].every(t => t.getBoundingClientRect().right <= list.getBoundingClientRect().right + 0.5); }));
  check(`${S}: today no horizontal overflow`, await noHScroll(page));
  await shot(page, `${S}-today`);

  // 课堂
  await page.locator('.lesson-row', { hasText: '圆锥曲线 · 中点弦与点差法' }).click();
  check(`${S}: lesson heading`, await page.getByRole('heading', { name: '圆锥曲线 · 中点弦与点差法' }).isVisible());
  check(`${S}: assessment receipt`, await page.locator('.receipt').isVisible());
  const panel = page.getByRole('complementary', { name: '资料面板' });
  check(`${S}: companion shows card`, await panel.getByRole('heading', { name: '中点弦的斜率' }).isVisible());
  check(`${S}: system rows hidden by default`, await page.locator('.sysrow').count() === 0);
  const text = await page.locator('#main').innerText();
  check(`${S}: no engineering vocabulary`, !/ask_worker|session|System prompt|Context injection|Workspace Write|Standard mode|HARNESS|\.md\b/i.test(text));
  await page.locator('.step summary').first().click();
  check(`${S}: step row expands`, await page.getByText('学情条目「倾向先代数展开」').isVisible());
  await shot(page, `${S}-lesson`);

  const draft = page.locator('#draft-l1');
  await draft.fill('我想再练一道类似的题');
  await draft.press('Enter');
  check(`${S}: message sent`, await page.locator('.msg-user .bubble', { hasText: '我想再练一道类似的题' }).isVisible());
  await page.getByText('收到。我先看看你的思路').waitFor({ timeout: 4000 });
  check(`${S}: teacher reply`, true);

  await page.locator('.composer [data-act="skills"]').click();
  check(`${S}: skill menu`, await page.getByRole('menu').getByText('路线规划').isVisible());
  await page.getByRole('menu').getByText('更多技能').click();
  check(`${S}: more skills expand`, await page.getByRole('menu').getByText('数学关注').isVisible());
  await page.getByRole('menu').getByText('备课', { exact: true }).click();
  check(`${S}: skill inserted into draft`, (await draft.inputValue()).startsWith('【备课】'));
  check(`${S}: menu closes after pick`, await page.locator('#menu').count() === 0);

  await page.getByRole('button', { name: '教学设置' }).click();
  await page.getByRole('dialog').getByText('费曼法').click();
  await page.getByRole('dialog').getByRole('button', { name: '保存设置' }).click();
  check(`${S}: teaching method saved`, (await page.locator('.lh-meta .badge').first().textContent()) === '费曼法');

  await page.getByRole('tab', { name: '教室' }).click();
  check(`${S}: classroom workers`, await page.getByText('题目研究员').first().isVisible() && await page.getByText('后台工作员 · 结果只交给老师').isVisible());
  await shot(page, `${S}-classroom`);
  await page.getByRole('tab', { name: '对话' }).click();

  await panel.getByRole('button', { name: '图谱', exact: true }).click();
  check(`${S}: companion graph`, await page.locator('svg[data-graph="compact"]').isVisible());
  await page.locator('svg[data-graph="compact"] [data-gnode="i-diff"]').click();
  check(`${S}: companion node opens file`, await panel.getByRole('heading', { name: '二次式相减会暴露线性关系' }).isVisible());
  const before = (await page.locator('.companion').boundingBox()).width, hb = await page.locator('.split-handle').boundingBox();
  await page.mouse.move(hb.x + 0.5, hb.y + 200); await page.mouse.down(); await page.mouse.move(hb.x - 120, hb.y + 200, { steps: 6 }); await page.mouse.up();
  const after = (await page.locator('.companion').boundingBox()).width;
  check(`${S}: split handle resizes`, after > before + 60, `${before} -> ${after}`);

  // 资料库
  await nav(page, '资料库');
  check(`${S}: library inspector`, await page.getByRole('complementary', { name: '属性' }).getByRole('button', { name: '带入对话' }).isVisible());
  await shot(page, `${S}-library-files`);
  await page.getByRole('tab', { name: '卡片' }).click();
  const total = await page.locator('.kcard').count();
  await page.locator('.filterbar .chip', { hasText: '#圆锥曲线' }).click();
  const conic = await page.locator('.kcard').count();
  check(`${S}: card tag filter`, total === 10 && conic === 4, `${total}/${conic}`);
  await page.locator('.filterbar .chip', { hasText: '#圆锥曲线' }).click();
  await page.getByLabel('复习状态').selectOption('due');
  check(`${S}: card review filter`, await page.locator('.kcard').count() === 4);
  await page.getByLabel('复习状态').selectOption('all');
  await shot(page, `${S}-library-cards`);
  await page.getByRole('tab', { name: '图谱' }).click();
  check(`${S}: graph nodes`, await page.locator('svg[data-graph="full"] [data-gnode]').count() === 17);
  await page.locator('svg[data-graph="full"] [data-gnode="t-chord"]').click();
  const detail = page.getByRole('complementary', { name: '节点详情' });
  check(`${S}: graph detail`, await detail.getByRole('heading', { name: '中点弦问题' }).isVisible() && await detail.getByText('直接子卡 · 2').isVisible());
  await page.locator('svg[data-graph="full"] [data-gnode="c-midchord"]').hover();
  check(`${S}: graph hover highlights neighbours`, await page.locator('svg[data-graph="full"].hovering').count() === 1 && await page.locator('svg[data-graph="full"] .g-node.near').count() >= 3);
  await shot(page, `${S}-graph`);
  await page.mouse.move(5, 5);
  await detail.getByRole('button', { name: '带入对话' }).click();
  await page.getByRole('menu').getByText('当前课堂').click();
  check(`${S}: bring to current lesson`, await page.locator('.composer .ref-chip', { hasText: '中点弦问题' }).isVisible());

  // 计划
  await nav(page, '计划');
  check(`${S}: route lanes`, await page.locator('.lane').count() === 3);
  await page.locator('.node', { hasText: '焦点弦与弦长' }).click();
  check(`${S}: node drawer`, await page.getByRole('complementary', { name: '课程详情' }).getByRole('button', { name: '开始这节课' }).isVisible());
  await shot(page, `${S}-plan-routes`);
  await page.getByRole('tab', { name: '日历' }).click();
  check(`${S}: calendar today selected`, await page.locator('.day[data-today][aria-pressed="true"]').count() === 1);
  check(`${S}: agenda lists today's lesson`, await page.getByRole('complementary', { name: '当天安排' }).getByText('焦点弦与弦长').isVisible());
  await shot(page, `${S}-calendar`);
  await page.getByRole('tab', { name: /复习/ }).click();
  await page.locator('.review-item', { hasText: '中点弦的斜率' }).click();
  const save = page.getByRole('button', { name: '保存评估' });
  check(`${S}: review save disabled until complete`, await save.isDisabled());
  await page.getByLabel('能力 1').fill('未经提示想到两式相减');
  await page.getByRole('radio', { name: '已表现' }).click();
  await page.getByLabel('证据说明').fill('换题面后自己想到相减');
  check(`${S}: review save enabled`, await save.isEnabled());
  await shot(page, `${S}-review`);
  await save.click();
  check(`${S}: review schedule updated`, await page.getByRole('status').filter({ hasText: '已保存能力评估并更新复习安排。' }).isVisible());
  check(`${S}: new history entry`, (await page.locator('.hist').first().innerText()).includes('9月24日'));
  await page.getByRole('button', { name: '撤销最近一次评估' }).click();
  check(`${S}: undo review`, await page.getByRole('status').filter({ hasText: '已撤销最近一次评估' }).isVisible());

  // 设置：深色、调试
  await nav(page, '今日');
  await nav(page, '设置');
  await page.getByRole('dialog').getByRole('button', { name: '深色' }).click();
  check(`${S}: dark theme`, await page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
  await page.getByRole('dialog').getByRole('button', { name: '完成' }).click();
  await shot(page, `${S}-today-dark`);
  await page.locator('.lesson-row', { hasText: '圆锥曲线 · 中点弦与点差法' }).click();
  await shot(page, `${S}-lesson-dark`);
  await nav(page, '设置');
  await page.getByRole('dialog').getByRole('button', { name: '浅色' }).click();
  await page.getByRole('dialog').getByLabel(/调试模式/).check();
  await page.getByRole('dialog').getByRole('button', { name: '完成' }).click();
  check(`${S}: debug shows trace tab and system rows`, await page.getByRole('tab', { name: '轨迹' }).isVisible() && await page.locator('.sysrow').count() === 2);
  await nav(page, '设置');
  await page.getByRole('dialog').getByLabel(/调试模式/).uncheck();
  if (style === 'modern') {
    await page.getByRole('dialog').getByRole('button', { name: '手写手帐' }).click();
    check('modern: switch to notebook in settings', await page.evaluate(() => document.documentElement.dataset.sfStyle === 'notebook' && location.search === '?style=notebook'));
    await page.getByRole('dialog').getByRole('button', { name: '现代简约' }).click();
    check('modern: switch back', await page.evaluate(() => document.documentElement.dataset.sfStyle === 'modern' && location.search === ''));
  }
  await page.getByRole('dialog').getByRole('button', { name: '完成' }).click();
  check(`${S}: debug off again`, await page.getByRole('tab', { name: '轨迹' }).count() === 0);

  if (style === 'modern') {
    // 今日输入框直接开课
    await nav(page, '今日');
    await page.locator('#launch-input').fill('求 1 + 2 + … + n 的和，我只会一项项加');
    await page.locator('#launch-input').press('Enter');
    check('modern: launch creates lesson', await page.locator('.msg-user .bubble', { hasText: '一项项加' }).isVisible() && await page.locator('.lesson-row[aria-current="page"]').count() === 1);
    await page.getByText('收到。我先看看你的思路').waitFor({ timeout: 4000 });
    // 空白学习空间
    await page.getByRole('button', { name: '原型' }).click();
    await page.getByRole('button', { name: '空白学习空间' }).click();
    await nav(page, '今日');
    check('modern: empty today onboarding', await page.getByText('这是一个全新的学习空间').isVisible());
    check('modern: empty sidebar', await page.getByText('还没有课堂。点「新的一课」开始。').isVisible() || await page.locator('.lesson-row').count() === 1);
    check('modern: empty has no due badge', await page.locator('.nav-count').count() === 0);
    await page.getByRole('button', { name: '原型' }).click();
    await shot(page, 'modern-empty-today');
    await nav(page, '资料库');
    check('modern: library nav keeps last sub-view', await page.getByRole('tab', { name: '图谱' }).getAttribute('aria-selected') === 'true');
    await page.getByRole('tab', { name: '文件' }).click();
    check('modern: empty library', await page.getByText('资料库还是空的').first().isVisible());
    await page.getByRole('tab', { name: '图谱' }).click();
    check('modern: empty graph', await page.getByText('图谱还是空的').isVisible());
    await nav(page, '计划');
    await page.getByRole('tab', { name: '路线' }).click();
    check('modern: empty routes', await page.getByText('还没有学习路线').first().isVisible());
    await page.getByRole('tab', { name: /复习/ }).click();
    check('modern: empty review', await page.getByText('今天没有到期的卡片').isVisible());
    await page.locator('.new-lesson').click();
    check('modern: blank lesson hero', await page.getByRole('heading', { name: '今天想学什么？' }).isVisible());
    await shot(page, 'modern-new-lesson');
    await page.getByRole('button', { name: '原型' }).click();
    await page.getByRole('button', { name: '示例数据' }).click();
    for (const width of [1024, 900]) {
      await page.setViewportSize({ width, height: 800 });
      for (const hash of ['#/today', '#/library/files', '#/library/graph', '#/plan/routes', '#/plan/calendar', '#/plan/review', '#/lesson/l1']) {
        await page.evaluate(h => { location.hash = h; }, hash);
        await page.waitForTimeout(60);
        check(`modern ${width}: ${hash} no horizontal overflow`, await noHScroll(page));
      }
    }
  }
  await ctx.close();
}

async function narrow(style) {
  const S = style, { ctx, page } = await open(style, { width: 390, height: 844 });
  check(`${S} 390: today no overflow`, await noHScroll(page));
  await shot(page, `${S}-narrow-today`);
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.waitForTimeout(250);
  const side = await page.locator('#side').boundingBox();
  check(`${S} 390: drawer opens in view`, side.x >= -1 && side.x + side.width <= 390, JSON.stringify(side));
  await page.locator('.lesson-row', { hasText: '圆锥曲线 · 中点弦与点差法' }).click();
  await page.waitForTimeout(250);
  check(`${S} 390: drawer closes after navigation`, (await page.locator('#side').boundingBox()).x < -100);
  check(`${S} 390: companion overlays chat`, (await page.locator('.companion').boundingBox()).width >= 380);
  await page.getByRole('button', { name: '关闭资料面板' }).click();
  const composer = await page.locator('.composer').boundingBox();
  check(`${S} 390: composer inside viewport`, composer.x >= 0 && composer.x + composer.width <= 390 && composer.y + composer.height <= 844, JSON.stringify(composer));
  const send = await page.locator('.composer .send').boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.send') !== null, [send.x + send.width / 2, send.y + send.height / 2]);
  check(`${S} 390: send button hit-testable`, hit);
  check(`${S} 390: lesson no overflow`, await noHScroll(page));
  await shot(page, `${S}-narrow-lesson`);
  for (const hash of ['#/library/files', '#/library/cards', '#/plan/routes', '#/plan/calendar', '#/plan/review']) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForTimeout(60);
    check(`${S} 390: ${hash} no horizontal overflow`, await noHScroll(page));
  }
  await ctx.close();
}

try {
  for (const style of ['modern', 'notebook']) { await desktop(style); await narrow(style); }
} finally {
  await browser.close();
}
check('no console errors, page errors or failed requests', problems.length === 0, problems.join('\n'));
const failed = results.filter(r => !r.ok);
writeFileSync(OUT + 'verification.json', JSON.stringify({
  prototype: 'docs/ui/notara-frontend-prototype.html', browser: 'Chromium via Playwright 1.63.0, headless',
  passed: results.length - failed.length, failed: failed.length, problems, screenshots: shots, results,
}, null, 2) + '\n');
console.log(`passed ${results.length - failed.length}, failed ${failed.length}, problems ${problems.length}`);
if (failed.length) process.exitCode = 1;
