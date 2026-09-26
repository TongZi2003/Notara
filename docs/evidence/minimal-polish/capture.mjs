// Visual baseline capture for the Native Vault minimal ("modern") theme.
// Usage: node docs/evidence/minimal-polish/capture.mjs <output-dir>
// Reads the live auth URL from .runtime/modern-preview.json (never writes the
// token anywhere). Console errors and pageerrors land in <out>/console.json.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const outDir = resolve(process.argv[2] ?? 'docs/evidence/minimal-polish/before');
await mkdir(outDir, { recursive: true });
const { authUrl, root } = JSON.parse(await readFile('.runtime/modern-preview.json', 'utf8'));
if (!authUrl || !root) throw new Error('modern-preview.json missing authUrl/root — is the isolated vault running?');

const notes = [];
const consoleLog = { errors: [], pageerrors: [], notes };
const shot = async (page, name) => {
  const path = join(outDir, name);
  await page.screenshot({ path });
  console.log('shot', name);
};

// Scripted test-model replies live in the run's own data root (same mechanism
// as tests/e2e/native-vault-classroom.spec.ts). The first reply drives a real
// write_lesson_board call so the board tab and a tool row have real content.
const QUESTION = '什么是椭圆的第一定义？';
const PRACTICE = '出一道小题让我试试';
await writeFile(join(root, 'teacher-replies.json'), JSON.stringify({
  [QUESTION]: {
    calls: [{ name: 'write_lesson_board', arguments: {
      title: '椭圆的第一定义',
      body: '到两个定点 $F_1$、$F_2$ 的距离之和为常数 $2a$（$2a>|F_1F_2|$）的点的轨迹。\n\n- 两个定点叫**焦点**\n- 常数必须大于焦距，否则轨迹不存在\n\n[[知识/圆锥曲线.md|圆锥曲线]]',
      kind: 'note',
    } }],
    text: '我把定义写到了白板上：椭圆是到两焦点距离之和为常数的点的轨迹。关键是“常数”必须大于焦距，否则轨迹不存在。',
  },
  [PRACTICE]: '好，请尝试：椭圆 $x^2/9+y^2/4=1$ 上一点到两焦点的距离之和是多少？先写出你的判断，再说明理由。',
}, null, 2) + '\n');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
page.on('pageerror', error => consoleLog.pageerrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleLog.errors.push(message.text()); });
// Optional: `--css <file>` injects a stylesheet into every document (demo layer).
const cssArg = process.argv.indexOf('--css');
if (cssArg > 0) await page.addInitScript(css => {
  const add = () => { const s = document.createElement('style'); s.dataset.polishDemo = ''; s.textContent = css; document.head.append(s); };
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add, { once: true });
}, await readFile(process.argv[cssArg + 1], 'utf8'));

const composer = page.locator('[data-composer-input]').last();
const sidebar = page.locator('aside.nv-sidebar');
const tab = name => page.getByRole('tab', { name, exact: true });
const shellTab = name => page.getByRole('tablist', { name: /资料库视图|计划视图/ }).getByRole('tab', { name, exact: true });
const navButton = label => sidebar.locator('nav').getByRole('button', { name: label, exact: true });
const send = async text => { await composer.click(); await page.keyboard.insertText(text); await composer.press('Enter'); };
const step = async (label, fn) => {
  try { await fn(); } catch (error) {
    const lines = String(error?.message ?? error).split('\n').map(l => l.trim()).filter(Boolean);
    const detail = lines.find(l => l.startsWith('waiting for')) ?? lines[0];
    notes.push(`${label}: ${lines[0]} | ${detail}`);
    console.log('MISS', label, '-', detail);
  }
};

await page.goto(authUrl);
for (const name of ['Configure later', 'Continue']) {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.isVisible().catch(() => false)) { await button.click(); break; }
}
await page.locator('aside.nv-sidebar').waitFor({ timeout: 30_000 });
await page.locator('.nv-home-task, .nv-home-empty').first().waitFor({ timeout: 30_000 }).catch(() => notes.push('today agenda never settled'));
await page.waitForTimeout(1200);
await shot(page, 'today.png');

// 新的一课 entry page.
await sidebar.getByRole('button', { name: '新的一课', exact: true }).click();
await page.getByRole('heading', { name: '新的一课', exact: true }).waitFor({ timeout: 20_000 });
await composer.waitFor({ state: 'visible', timeout: 20_000 });
await shot(page, 'new-lesson.png');

// Classroom conversation: scripted board write (approved once), then a reply.
// The approval panel is locale-dependent; accept either dictionary.
await send(QUESTION);
await step('approval', async () => {
  const approve = page.getByRole('button', { name: /^(Allow once|允许一次|Approve|批准)$/ }).first();
  await approve.click({ timeout: 25_000 });
});
await step('board reply', async () => {
  await page.getByText('我把定义写到了白板上').waitFor({ timeout: 40_000 });
});
await send(PRACTICE);
await step('practice reply', async () => {
  await page.getByText('先写出你的判断').waitFor({ timeout: 40_000 });
});
await page.waitForTimeout(800);
await shot(page, 'classroom.png');

// Composer model + permission menus.
const menuItem = page.locator('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option]').first();
await step('model menu', async () => {
  await page.getByRole('button', { name: /^Select model|^选择模型/ }).click();
  await menuItem.waitFor({ timeout: 8_000 });
  await page.waitForTimeout(400);
  await shot(page, 'menu.png');
  await page.keyboard.press('Escape');
});
await step('permission menu', async () => {
  await page.getByRole('button', { name: /^Access mode|^访问模式|^权限/ }).click();
  await menuItem.waitFor({ timeout: 8_000 });
  await page.waitForTimeout(400);
  await shot(page, 'menu-permission.png');
  await page.keyboard.press('Escape');
});

// 白板 / 教室 tabs.
await step('board tab', async () => {
  await tab('白板').click();
  await page.locator('.nb-board').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot(page, 'board.png');
});
await step('room tab', async () => {
  await tab('教室').click();
  await page.getByRole('region', { name: '教室区域', exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot(page, 'room.png');
});

// Library: 文件 with a markdown page open, 卡片, 图谱 with a node detail.
await step('library files', async () => {
  await navButton('资料库').click();
  await page.locator('.nv-assets').first().waitFor({ timeout: 15_000 });
  // The rail may restore collapsed; rows render only once expanded.
  // Rail rows carry an empty aria-label, so match by text content.
  await page.locator('.nv-file-rail').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  const fileBtn = page.locator('.nv-file-rail').getByRole('button').filter({ hasText: '圆锥曲线.md' }).first();
  const expand = page.getByRole('button', { name: '展开文件栏', exact: true }).first();
  if (await expand.count() > 0) await expand.click();
  await fileBtn.waitFor({ timeout: 10_000 });
  await fileBtn.click();
  await page.locator('.cm-editor').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await shot(page, 'files.png');
});
await step('library cards', async () => {
  await shellTab('卡片').click();
  await page.locator('.nv-card').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, 'cards.png');
});
await step('library graph', async () => {
  await shellTab('图谱').click();
  await page.locator('.nv-graph-board, .nv-graph-layout').first().waitFor({ timeout: 15_000 });
  await step('graph node', async () => {
    await page.getByRole('button', { name: '图谱节点 圆锥曲线', exact: true }).first().click({ timeout: 8_000 });
    await page.getByRole('complementary', { name: '节点详情' }).waitFor({ timeout: 8_000 });
  });
  await page.waitForTimeout(500);
  await shot(page, 'graph.png');
});

// Plan: 路线 with a lesson detail, 日历, 复习 with one row selected.
await step('plan routes', async () => {
  await navButton('计划').click();
  // The rail defaults to the first route (seeded 向量学习路线, no lessons);
  // pick the fixture route that actually carries lessons.
  await page.locator('.nv-route-card').filter({ hasText: '圆锥曲线' }).first().click();
  await page.locator('.nv-route-node').first().waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '路线节点 中点弦与点差法', exact: true }).click();
  await page.getByRole('complementary', { name: '课程详情' }).waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'routes.png');
});
await step('plan calendar', async () => {
  await shellTab('日历').click();
  await page.locator('.nv-month-day').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, 'calendar.png');
});
await step('plan review', async () => {
  await shellTab('复习').click();
  const row = page.locator('.nv-review-row').first();
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await page.locator('.nv-review-detail').waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'review.png');
});

// Settings dialog, directory picker, collapsed sidebar.
await step('settings', async () => {
  await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
  await page.getByRole('dialog').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await shot(page, 'settings.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});
await step('directory picker', async () => {
  await sidebar.getByRole('button', { name: /^选择目录|^选择学习目录/ }).click();
  await page.getByRole('dialog', { name: '选择学习目录' }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await shot(page, 'directory.png');
  await page.getByRole('dialog', { name: '选择学习目录' }).getByRole('button', { name: '关闭', exact: true }).click();
});
await step('collapsed sidebar', async () => {
  await navButton('今日').click();
  await page.locator('.nv-home').waitFor({ timeout: 15_000 });
  await sidebar.getByRole('button', { name: '收起导航', exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, 'collapsed.png');
  await sidebar.getByRole('button', { name: '展开导航', exact: true }).click();
});

// Dark scheme. The app resolves `system` through prefers-color-scheme; verify
// the body attribute actually flipped, else fall back to the Settings row.
const darkOn = async () => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'));
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(1200);
if (!(await darkOn())) {
  notes.push('colorScheme emulation did not switch the theme; using Settings row');
  await step('dark via settings', async () => {
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^(General|通用)$/ }).click().catch(() => {});
    await dialog.getByRole('radio', { name: /^(深色|Dark)$/ }).click();
    await page.keyboard.press('Escape');
  });
  await page.waitForTimeout(800);
}
consoleLog.darkApplied = await darkOn();
await step('dark today', async () => {
  await navButton('今日').click();
  await page.locator('.nv-home').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await shot(page, 'dark-today.png');
});
await step('dark cards', async () => {
  await navButton('资料库').click();
  await shellTab('卡片').click();
  await page.locator('.nv-card').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, 'dark-cards.png');
});
await step('dark classroom', async () => {
  await sidebar.locator('.nv-session-row').first().click();
  // The pane restores its last view (白板/教室); the conversation is on 对话.
  await tab('对话').click();
  await page.locator('[data-composer-input]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot(page, 'dark-classroom.png');
});
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(800);

// Narrow 390x844, light.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await step('narrow today', async () => {
  await navButton('今日').click();
  await page.locator('.nv-home').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await shot(page, 'narrow-today.png');
});
await step('narrow classroom', async () => {
  const row = sidebar.locator('.nv-session-row').first();
  if (await row.isVisible().catch(() => false)) await row.click();
  else {
    const open = page.getByRole('button', { name: /^(Open sidebar|展开)/ });
    if (await open.first().isVisible().catch(() => false)) { await open.first().click(); await sidebar.locator('.nv-session-row').first().click(); }
  }
  if (await tab('对话').isVisible().catch(() => false)) await tab('对话').click();
  await page.waitForTimeout(800);
  await shot(page, 'narrow-classroom.png');
});

await writeFile(join(outDir, 'console.json'), JSON.stringify(consoleLog, null, 2) + '\n');
await browser.close();
console.log('done:', outDir);
