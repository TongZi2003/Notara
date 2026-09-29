/**
 * Capture the website screenshots from the real Vault UI, driven by the
 * scripted test model and hand-written sample material in an isolated runtime
 * (temporary data directory and port; no real lessons are touched). Output:
 * website/public/images/{lesson,whiteboard,understanding}.webp.
 *
 *   npm run site:capture
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault } from '../../tests/fixtures/vault-http.ts';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/images');
await mkdir(out, { recursive: true });

const chordCard = `---
type: card
tags: [数学, 圆锥曲线]
---
# 抛物线的弦：斜率等于两端横坐标之和

## 内容

抛物线 $y=x^2$ 上有两点 $P(p,p^2)$、$Q(q,q^2)$，求弦 $PQ$ 的斜率。

## 参考理解

$k_{PQ}=\\dfrac{p^2-q^2}{p-q}=p+q$。把抛物线整体上下平移，这个结论不变。

## 学生理解

一开始按两点式硬算；约分以后发现结果只和两个横坐标有关。

**当前判断**：能推出这个结论；还没有在别的题里主动用过。
`;

const rectangleCard = `---
type: card
tags: [数学, 圆锥曲线]
---
# 抛物线上的矩形：先看弦的斜率

## 内容

矩形 $ABCD$ 有三个顶点在抛物线 $y=x^2+\\frac14$ 上，求证这个矩形的周长大于 $3\\sqrt3$。

## 参考理解

设直角顶点为 $B$，$A$、$C$ 与它相邻。弦的斜率等于两端横坐标之和，所以 $(a+b)(b+c)=-1$。设 $k=a+b$，由对称性不妨设 $k\\ge1$，则

$$|AB|+|BC|=\\sqrt{1+k^2}\\Big(|k-2b|+\\frac{|\\frac1k+2b|}{k}\\Big)\\ge\\frac{\\sqrt{1+k^2}}{k}\\Big(|k-2b|+\\Big|\\frac1k+2b\\Big|\\Big)\\ge\\frac{(1+k^2)^{3/2}}{k^2}.$$

右边在 $k^2=2$ 时取最小值 $\\frac{3\\sqrt3}{2}$。取等要求 $k=2b$，即 $a=b$，$A$、$B$ 重合，不可能，所以周长大于 $3\\sqrt3$。

## 学生理解

一开始用 $AB\\perp BC$ 直接展开，式子太乱，没有继续下去。

想起旧卡片里“弦的斜率等于两端横坐标之和”，把垂直条件写成 $(a+b)(b+c)=-1$，两条边长只剩 $k$ 和 $b$。

用三角不等式消去 $b$，是在老师提示“不妨设 $k\\ge1$”之后做到的。

**当前判断**：能把周长化成 $k$ 的函数；求 $\\frac{(1+k^2)^{3/2}}{k^2}$ 的最小值、说明等号取不到，还没有独立检验。
`;

const first = '矩形 ABCD 有三个顶点在抛物线 y = x² + 1/4 上，求证它的周长大于 3√3。我设了三个顶点的坐标，想用 AB ⊥ BC，可展开以后式子太乱。先别给答案。';
const second = '弦的斜率等于两端横坐标之和！那 AB 的斜率是 a+b，BC 的是 b+c，垂直就是 (a+b)(b+c) = −1。';
const lastLine = '周长里还剩一个 $b$。不妨设 $k\\ge1$，你能把它消掉吗？';

const keyStep = `## 抛物线上的弦

$A(a,\\,a^2+\\tfrac14)$、$B(b,\\,b^2+\\tfrac14)$ 连线的斜率：

$$k_{AB}=\\frac{a^2-b^2}{a-b}=a+b$$

## 设 $k=a+b$

$AB\\perp BC$：$(a+b)(b+c)=-1$，所以 $BC$ 的斜率是 $-\\dfrac1k$。

<mark data-color="orange">边长 = 横坐标差 × $\\sqrt{1+\\text{斜率}^2}$</mark>

$$|AB|=|k-2b|\\sqrt{1+k^2}$$

$$|BC|=\\Big|\\frac1k+2b\\Big|\\cdot\\frac{\\sqrt{1+k^2}}{k}$$

**想一想**：周长里还剩一个 $b$，怎样把它消掉？`;

const figure = `\`\`\`figure
axes x -1.6..1.9 y -0.3..2.9
function f(x) = x^2 + 1/4
point A = (1.214, 1.724)
point B = (0.2, 0.29)
point C = (-0.907, 1.073)
point D = (0.107, 2.507)
polygon A B C D
angle A B C
\`\`\`

三个顶点 $A$、$B$、$C$ 在抛物线上，$B$ 是直角顶点。`;

const runtime = await startVaultIsolated({ testModel: true });
const client = await connectVault(runtime);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 930 }, deviceScaleFactor: 1, colorScheme: 'light' });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const shoot = async (name: string) => {
  const png = await page.screenshot();
  await sharp(png).webp({ quality: 84 }).toFile(join(out, `${name}.webp`));
};

try {
  const write = async (path: string, text: string) => {
    const file = join(runtime.root, 'workspace/vault', path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  await write('卡片/抛物线的弦.md', chordCard);
  await write('卡片/抛物线上的矩形.md', rectangleCard);

  await client.script({
    '__session-title': '抛物线上的矩形',
    [first]: '抓住直角这个条件，方向是对的。先别急着展开。\n\n你在《抛物线的弦》那张卡片里写过一个结论：抛物线上一条弦的斜率，和两端的横坐标有什么关系？还记得吗？',
    [second]: {
      calls: [
        { name: 'write_lesson_board', arguments: { title: '关键一步：弦的斜率与边长', section: '抛物线上的矩形', size: 'wide', body: keyStep } },
        { name: 'write_lesson_board', arguments: { title: '三个顶点在抛物线上', section: '抛物线上的矩形', size: 'narrow', placement: { relativeTo: '关键一步：弦的斜率与边长', position: 'beside' }, body: figure } },
      ],
      text: `对，就是这个结论。\n\n边长也能用同一个办法写：**横坐标差乘以 $\\sqrt{1+\\text{斜率}^2}$**。我把两条边写在白板上了。\n\n${lastLine}`,
    },
  });

  await page.goto(runtime.authUrl);
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
  if (await later.isVisible()) await later.click();
  const input = page.locator('[data-composer-input][contenteditable="true"]').last();
  await input.fill(first);
  await input.press('Enter');
  await expect(page.getByText('还记得吗？')).toBeVisible({ timeout: 30000 });
  await input.fill(second);
  await input.press('Enter');
  await expect(page.getByText('你能把它消掉吗？')).toBeVisible({ timeout: 30000 });
  for (const session of await client.sessions()) {
    const failed = (await client.outcomes(session.sessionId)).filter(outcome => outcome.failed);
    if (failed.length) throw new Error(`tool calls failed: ${JSON.stringify(failed)}`);
  }
  await page.waitForTimeout(600);
  await shoot('lesson');

  await page.getByRole('tablist', { name: '课堂视图' }).getByRole('tab', { name: '白板', exact: true }).click();
  await expect(page.locator('.nb-board')).toBeVisible();
  await expect(page.locator('.nb-block').filter({ hasText: '关键一步' })).toBeVisible();
  await expect(page.locator('.nb-figure-board svg').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  await shoot('whiteboard');

  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const expand = page.getByRole('button', { name: '展开文件栏', exact: true });
  if (await expand.count()) await expand.click();
  const folder = page.getByRole('button', { name: '卡片', exact: true });
  if (await folder.count()) await folder.first().click();
  await page.getByRole('button', { name: /抛物线上的矩形\.md/ }).first().click();
  await expect(page.locator('.cm-content')).toContainText('学生理解');
  await page.waitForTimeout(600);
  await shoot('understanding');
  console.log(JSON.stringify({ screenshots: ['lesson', 'whiteboard', 'understanding'].map(name => `website/public/images/${name}.webp`), pageErrors: errors }));
} finally {
  await browser.close();
  await client.close();
  await runtime.stop();
}
