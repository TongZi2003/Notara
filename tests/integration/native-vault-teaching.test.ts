/**
 * Native Vault teaching acceptance over the real HTTP Host — no browser.
 *
 * Every host, tool, approval, projection and file fact here is produced by the
 * isolated runtime this repository ships (`startVaultIsolated`): a temp DSH_HOME
 * plus a temp classroom, the real DSH Host, and the plugin's own preset. The one
 * substitute is the model backend — a scripted LlmAdapter that records the
 * request it actually received, so "the learner-visible material reached the
 * model" is read from the assembled request instead of asserted in prose.
 *
 * The classroom no longer ships a parallel authoring tool surface: ordinary
 * material, memory and shell work runs through the native `read`/`read_image`/
 * `glob`/`grep`/`write`/`edit`/`bash`/`skill` tools and the bundled command line,
 * and only the four lifecycle operations below stay dedicated. These cases own
 * that non-UI runtime contract: settings→request assembly, native reads, native
 * approval, native version CAS, route session identity and the summary/archive
 * path.
 *
 * The learner-facing surface (composer, settings dialog, route bench, canvas
 * controls) is validated in the Playwright lane.
 */
import { afterEach, expect, test } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, effectiveSystemText, outcomeJson, skillNames, toolNames, toolResultTexts, type VaultHarness } from '../fixtures/vault-http.ts';

interface TeachingChoice { id: string; title: string; description: string }
interface TeachingSettings {
  revision: number;
  teachingRef: string;
  learningGoal: { title: string; dailyMinutes?: number } | null;
  temporaryInstructions: string;
  subjects: string[];
  scriptPath: string | null;
  continuation: unknown;
  choices: TeachingChoice[];
}
interface RouteNode { id: string; title: string; routePath: string; routeRevision: string; parent: string | null; scriptPath: string | null; sessionId: string | null }
interface RoutesView { routes: { path: string; title: string; revision: string; ref: string }[]; nodes: RouteNode[] }
interface LessonLogView { hits: { path: string; ref: string; title?: string; continuation?: string | null }[]; total: number }
interface SavedSummary { saved?: boolean; archived?: boolean; path?: string; anchor?: string }

/** The only dedicated classroom tools left after the minimal split. */
const NOTARA_TOOL_NAMES = ['save_lesson_summary', 'open_learning_lesson', 'set_teaching_settings', 'ask_worker'];
/** Native tools the teaching preset must actually offer in the assembled request. */
const NATIVE_TOOL_NAMES = ['read', 'read_image', 'glob', 'grep', 'write', 'edit', 'bash', 'skill'];
/** Retired classroom tools: none of them is callable, offered or kept as a
 * compatibility shape, so a caller can never be pulled back onto the old surface. */
const RETIRED_TOOL_NAMES = ['vault_list', 'vault_read', 'vault_search', 'vault_save', 'learning_find', 'learning_read', 'lesson_log_find', 'create_learning_route', 'review_queue', 'record_review', 'learning_calendar', 'schedule_learning_lesson'];

let runtime: VaultRuntime | undefined;
let harness: VaultHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await runtime?.stop();
  runtime = undefined;
});

/** Open one planned lesson through the route Remote (what the route bench does). */
async function openLesson(client: VaultHarness, bench: string, node: RouteNode): Promise<string> {
  return client.value(await client.rpc<{ sessionId: string }>('notaraVault/openRouteLesson', {
    input: { path: node.routePath, nodeId: node.id, expectedRevision: node.routeRevision, sessionId: bench },
  })).sessionId;
}
async function routes(client: VaultHarness, bench: string): Promise<RoutesView> {
  return client.value(await client.rpc<RoutesView>('notaraVault/routes', { input: { sessionId: bench } }));
}
function nodeIn(view: RoutesView, routePath: string, title: string): RouteNode {
  const node = view.nodes.find(row => row.routePath === routePath && row.title === title);
  if (!node) throw new Error(`route node missing: ${routePath} / ${title}`);
  return node;
}
/** The JSON payload a shell command printed: its own last well-formed JSON line. */
function commandJson<T extends { ok?: unknown }>(text: string): T {
  for (const line of text.split('\n').reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as T;
      if (parsed !== null && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    } catch { /* the echoed command is not the result line */ }
  }
  throw new Error(`no JSON result line in tool output: ${text.slice(0, 200)}`);
}

test('教学设置进入真实装配请求，同课切教法改变下一次请求，重启冷恢复且不串普通课', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();

  // 首次发送前的设置：默认教法来自 Host 自己的目录，不是客户端写死的一份名单。
  const initial = harness.value(await harness.rpc<TeachingSettings>('notaraVault/teachingSettings', { input: { sessionId } }));
  expect(initial).toMatchObject({ revision: 0, teachingRef: 'socratic', learningGoal: null, temporaryInstructions: '', subjects: [] });
  expect(initial.choices.map(choice => choice.id)).toEqual(['socratic', 'feynman', 'lecture', 'structural']);
  const updated = harness.value(await harness.rpc<TeachingSettings>('notaraVault/updateTeachingSettings', {
    input: { sessionId, expectedRevision: 0, patch: { teachingRef: 'feynman', learningGoal: { title: '理解条件概率', dailyMinutes: 30 }, temporaryInstructions: '先让我自己试', subjects: ['数学'] } },
  }));
  expect(updated).toMatchObject({ revision: 1, teachingRef: 'feynman', learningGoal: { title: '理解条件概率' }, temporaryInstructions: '先让我自己试' });

  const [firstTurn] = await harness.ask(sessionId, '我们从条件概率开始。', { '我们从条件概率开始。': '先说说你自己的解释。' });
  const firstWire = JSON.stringify(firstTurn);
  // 首条真实请求就带着所选教法、目标与临时要求 —— 不是第一次回复之后才补上。
  expect(effectiveSystemText(firstTurn!)).toContain('费曼法');
  expect(firstWire).toContain('理解条件概率');
  expect(firstWire).toContain('先让我自己试');
  // 教学预设真实挂载：四个课堂生命周期工具＋原生文件、搜索、终端与技能工具。
  expect(toolNames(firstTurn!)).toEqual(expect.arrayContaining([...NOTARA_TOOL_NAMES, ...NATIVE_TOOL_NAMES]));
  // 退役工具既不可调用也不再出现在工具面里，不保留旧的兼容形状。
  for (const name of RETIRED_TOOL_NAMES) expect(toolNames(firstTurn!)).not.toContain(name);
  expect(skillNames(firstTurn!).filter(name => name.startsWith('notara-')).length).toBeGreaterThan(0);

  // 同课切到讲解式：下一次真实请求换成新教法，目标与课堂都不变。
  harness.value(await harness.rpc('notaraVault/updateTeachingSettings', { input: { sessionId, expectedRevision: 1, patch: { teachingRef: 'lecture' } } }));
  const [secondTurn] = await harness.ask(sessionId, '还是你直接讲一遍吧。', { '还是你直接讲一遍吧。': '好，我按结构讲。' });
  const secondWire = JSON.stringify(secondTurn);
  // 生效的正文换成讲解式；原生提示词按 in-history 更新，旧快照留在历史里。
  expect(effectiveSystemText(secondTurn!)).toContain('讲解式');
  expect(effectiveSystemText(secondTurn!)).not.toContain('费曼法');
  expect(secondTurn!.messages.filter(message => message.role === 'system')).toHaveLength(2);
  expect(secondWire).toContain('理解条件概率');
  expect((await harness.turns(sessionId)).length).toBe(2);
  expect((await harness.sessions()).filter(row => row.sessionId === sessionId)).toHaveLength(1);

  // 冷恢复：重启后同一课堂的设置与历史都在，且没有长出第二条主线。
  await runtime.restart();
  harness = await connectVault(runtime);
  expect(harness.value(await harness.rpc<TeachingSettings>('notaraVault/teachingSettings', { input: { sessionId } })))
    .toMatchObject({ revision: 2, teachingRef: 'lecture', learningGoal: { title: '理解条件概率' }, temporaryInstructions: '先让我自己试', subjects: ['数学'] });
  const [thirdTurn] = await harness.ask(sessionId, '我们接着上一次继续。', { '我们接着上一次继续。': '继续。' });
  expect(effectiveSystemText(thirdTurn!)).toContain('讲解式');
  expect((await harness.turns(sessionId)).length).toBe(3);
  expect((await harness.sessions()).filter(row => row.sessionId === sessionId)).toHaveLength(1);

  // 普通预设：没有教学技能，没有课堂生命周期工具，退役工具同样不存在。
  const plain = await harness.createSession('standard');
  const [plainTurn] = await harness.ask(plain, '给我讲讲什么是向量。', { '给我讲讲什么是向量。': '向量可以看成……' });
  expect(plainTurn!.messages.some(message => message.source?.kind === 'user' && message.content.some(block => block.text === '给我讲讲什么是向量。'))).toBe(true);
  expect(skillNames(plainTurn!).filter(name => name.startsWith('notara-'))).toEqual([]);
  for (const name of [...NOTARA_TOOL_NAMES, ...RETIRED_TOOL_NAMES]) expect(toolNames(plainTurn!)).not.toContain(name);
}, 300_000);

test('原生 glob/grep/read 与 pdf-page 命令行进入装配请求，且不整库注入', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();

  // 目录用原生 glob：只给真实路径，不把整库正文带进来。
  const [, listTurn] = await harness.ask(sessionId, '这个课堂里现在都有哪些资料？', { '这个课堂里现在都有哪些资料？': [{ name: 'glob', arguments: { pattern: 'vault/**/*.md' } }] });
  const listOutcome = (await harness.outcomes(sessionId)).find(outcome => outcome.name === 'glob');
  expect(listOutcome?.failed).toBe(false);
  expect(listOutcome?.text).toContain('vault/知识/向量.md');
  expect(listOutcome?.text).toContain('vault/路线/向量路线.md');
  expect(listOutcome?.text).not.toContain('向量既可以用代数坐标表示');
  // 目录结果就是模型真拿到的那份文本，不是测试自己拼的清单。
  expect(toolResultTexts(listTurn!).join('\n')).toContain('vault/知识/向量.md');

  // 不给文件名也能搜到候选：正文检索走原生 grep，候选带真实路径与命中行。
  await harness.ask(sessionId, '有没有讲向量的资料？', { '有没有讲向量的资料？': [{ name: 'grep', arguments: { pattern: '向量', path: 'vault/知识', include: '*.md' } }] });
  const searchOutcome = (await harness.outcomes(sessionId)).find(outcome => outcome.name === 'grep');
  expect(searchOutcome?.failed).toBe(false);
  expect(searchOutcome?.text).toContain('vault/知识/向量.md');
  expect(searchOutcome?.text).toMatch(/Line \d+: .*向量/);

  // PDF 按页读走课堂自带的命令行：真实页文本、真实 revision 和一张真实页图。
  const pdfCommand = `printf '%s' '{"path":"媒体/向量讲义.pdf","page":2}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" pdf-page`;
  const [, afterPdfTurn] = await harness.ask(sessionId, '读一下向量讲义第2页的内容。', { '读一下向量讲义第2页的内容。': [{ name: 'bash', arguments: { command: pdfCommand, description: '[notara:material-read] 读向量讲义第 2 页' } }] });
  const pdfOutcome = (await harness.outcomes(sessionId)).find(outcome => outcome.name === 'bash');
  expect(pdfOutcome?.failed).toBe(false);
  const pdf = commandJson<{ ok: boolean; command: string; result: { path: string; page: number; pageCount: number; text: string; revision: string; imagePath: string } }>(pdfOutcome!.text);
  expect(pdf.ok).toBe(true);
  expect(pdf.command).toBe('pdf-page');
  expect(pdf.result.path).toContain('向量讲义.pdf');
  expect(pdf.result.page).toBe(2);
  expect(pdf.result.text).toContain('A point can be described by its coordinates.');
  expect(pdf.result.revision).toMatch(/^[0-9a-f]{24}$/);
  // 页图是真实落盘的图片文件；模型的多模态读图能力未验证，这里不为它下结论。
  const pageImage = await readFile(pdf.result.imagePath);
  expect(pageImage.length).toBeGreaterThan(1000);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
  expect(pageImage.subarray(0, 4).equals(pngMagic) || pageImage.subarray(0, 3).equals(jpegMagic)).toBe(true);
  // 页面读取沿原生沙箱执行；教学层不再为所有 Bash 额外制造审批。
  expect(harness.approvals.seen.map(prompt => prompt.toolName)).not.toContain('bash');
  // 页文本随工具结果进入下一次真实请求。
  expect(toolResultTexts(afterPdfTurn!).join('\n')).toContain('A point can be described by its coordinates.');

  // Markdown 正文按需 read，带上真实路径与完整文件事实。
  await harness.ask(sessionId, '知识库里的向量笔记正文读给我。', { '知识库里的向量笔记正文读给我。': [{ name: 'read', arguments: { file_path: 'vault/知识/向量.md' } }] });
  const mdOutcome = (await harness.outcomes(sessionId)).filter(outcome => outcome.name === 'read').at(-1);
  expect(mdOutcome?.failed).toBe(false);
  expect(mdOutcome?.text).toContain('vault/知识/向量.md');
  expect(mdOutcome?.text).toContain('向量既可以用代数坐标表示');
  expect(mdOutcome?.text).toMatch(/\(End of file - total \d+ lines\)/);
}, 300_000);

test('完全权限覆盖教学写入审批，PDF Bash 读取与真实落盘不再自动拒绝', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();
  const switched = harness.value(await harness.rpc<{ result: { kind: string } }>('commands/execute', { agentId: sessionId, line: '/permission danger-full-access', submittedAttachments: [] }));
  expect(switched.result.kind).not.toBe('error');
  await harness.ask(sessionId, '保存权限回归卡片', { '保存权限回归卡片': [{ name: 'write', arguments: { file_path: 'vault/卡片/权限回归.md', content: '---\ntype: card\n---\n# 权限回归\n\n文件已落盘。\n' } }] });
  expect((await harness.outcomes(sessionId)).find(row => row.name === 'write')?.failed).toBe(false);
  expect(await harness.readVaultFile('卡片/权限回归.md')).toContain('文件已落盘。');
  const command = `printf '%s' '{"path":"媒体/向量讲义.pdf","page":2}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" pdf-page`;
  await harness.ask(sessionId, '读取权限回归 PDF', { '读取权限回归 PDF': [{ name: 'bash', arguments: { command, description: '[notara:material-read] 读取第二页' } }] });
  const outcome = (await harness.outcomes(sessionId)).find(row => row.name === 'bash');
  expect(outcome?.failed).toBe(false);
  expect(outcome?.text).toContain('A point can be described by its coordinates.');
  expect(harness.approvals.seen).toHaveLength(0);
}, 120_000);

test('原生 write/edit 走原生批准与版本 CAS：允许落盘、拒绝不落盘、外部修改后旧版本写入失败', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();

  // 允许一次：文件真的落盘，工具结果是真实写入结果。
  const [, afterSaveTurn] = await harness.ask(sessionId, '把刚才的结论整理成一张卡片存下来。', { '把刚才的结论整理成一张卡片存下来。': [{ name: 'write', arguments: { file_path: 'vault/卡片/条件概率卡片.md', content: '---\ntype: card\ntitle: 条件概率卡片\n---\n# 条件概率卡片\n\n先确定条件，再看联合事件。\n' } }] });
  const saved = (await harness.outcomes(sessionId)).find(outcome => outcome.name === 'write');
  expect(saved?.failed).toBe(false);
  expect(saved?.text).toContain('vault/卡片/条件概率卡片.md');
  expect(saved?.text).toContain('Created file');
  expect(await harness.vaultExists('卡片/条件概率卡片.md')).toBe(true);
  expect(await harness.readVaultFile('卡片/条件概率卡片.md')).toContain('先确定条件，再看联合事件。');
  expect(toolResultTexts(afterSaveTurn!).join('\n')).toContain('Created file');
  // 写入确实经过了原生批准通路，而不是绕过它直接调用工具。
  expect(harness.approvals.seen).toHaveLength(1);
  expect(harness.approvals.seen[0]?.toolName).toBe('write');
  expect(harness.approvals.seen[0]?.callId).toBeTruthy();

  // 拒绝：不落盘，工具结果如实失败，模型看到的是拒绝而不是成功文案。
  harness.approvals.answer('rejected');
  const [, afterRejectTurn] = await harness.ask(sessionId, '再存一张卡片，这次先别批准。', { '再存一张卡片，这次先别批准。': [{ name: 'write', arguments: { file_path: 'vault/卡片/拒绝卡片.md', content: '---\ntype: card\ntitle: 拒绝卡片\n---\n# 拒绝卡片\n\n不该落盘。\n' } }] });
  const rejected = (await harness.outcomes(sessionId)).filter(outcome => outcome.name === 'write').at(-1);
  expect(rejected?.failed).toBe(true);
  expect(rejected?.text).toMatch(/reject|拒绝/i);
  expect(await harness.vaultExists('卡片/拒绝卡片.md')).toBe(false);
  expect((await harness.vaultFiles()).some(file => file.includes('拒绝卡片'))).toBe(false);
  expect(toolResultTexts(afterRejectTurn!).join('\n')).toContain(rejected?.text ?? 'missing');
  expect(harness.approvals.seen).toHaveLength(2);

  // 没有读过的文件不能被整份覆盖：原生写保护不是只有界面才有的规矩。
  await harness.ask(sessionId, '把向量笔记整份重写。', { '把向量笔记整份重写。': [{ name: 'write', arguments: { file_path: 'vault/知识/向量.md', content: '# 向量\n\n模型重写的内容。\n' } }] });
  const unread = (await harness.outcomes(sessionId)).filter(outcome => outcome.name === 'write').at(-1);
  expect(unread?.failed).toBe(true);
  expect(unread?.text).toMatch(/has not been read|without reading it first/i);
  expect(await harness.readVaultFile('知识/向量.md')).not.toContain('模型重写的内容。');
  // 写请求被批准了，失败原因是没读过：批准不等于假成功。
  expect(harness.approvals.seen).toHaveLength(3);

  // 先真实读一次，再按读到的版本改；外部修改之后旧版本的 edit 必须失败。
  await harness.ask(sessionId, '先读一下知识库里的向量笔记。', { '先读一下知识库里的向量笔记。': [{ name: 'read', arguments: { file_path: 'vault/知识/向量.md' } }] });
  const readOutcome = (await harness.outcomes(sessionId)).find(outcome => outcome.name === 'read');
  expect(readOutcome?.failed).toBe(false);
  expect(readOutcome?.text).toContain('向量既可以用代数坐标表示');
  const before = await harness.readVaultFile('知识/向量.md');
  await harness.writeVaultFile('知识/向量.md', `${before}\n外部补充：这里是别处改的内容。\n`);
  const [, afterConflictTurn] = await harness.ask(sessionId, '按上面读到的内容改写向量笔记。', { '按上面读到的内容改写向量笔记。': [{ name: 'edit', arguments: { file_path: 'vault/知识/向量.md', old_string: '向量既可以用代数坐标表示', new_string: '模型重写的内容' } }] });
  const conflicted = (await harness.outcomes(sessionId)).filter(outcome => outcome.name === 'edit').at(-1);
  expect(conflicted?.failed).toBe(true);
  expect(conflicted?.text).toMatch(/changed since it was read/i);
  expect(toolResultTexts(afterConflictTurn!).join('\n')).toContain(conflicted?.text ?? 'missing');
  const after = await harness.readVaultFile('知识/向量.md');
  expect(after).toContain('外部补充：这里是别处改的内容。');
  expect(after).not.toContain('模型重写的内容');
  // 写请求本身被批准了，失败原因是版本而不是权限：批准不等于假成功。
  expect(harness.approvals.seen).toHaveLength(4);
}, 300_000);

test('路线开课复用同一会话、交错时绑定真实前课，小结落点与原生归档可核对', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const bench = await harness.createSession();
  await mkdir(join(harness.vault, '备课'), { recursive: true });
  await harness.writeVaultFile('备课/第一课.md', '---\ntype: lesson\ntitle: 第一课\n---\n# 第一课\n\n## 本课重点\n\n- 基底与坐标的互相表示\n');

  const curve = harness.value(await harness.rpc<{ path: string }>('notaraVault/createRoute', { input: { sessionId: bench, title: '圆锥曲线', lessons: [{ title: '第一课', scriptPath: '备课/第一课.md' }, { title: '第二课' }] } }));
  const probability = harness.value(await harness.rpc<{ path: string }>('notaraVault/createRoute', { input: { sessionId: bench, title: '概率', lessons: [{ title: '概率第一课' }] } }));

  // 重复打开同一节点回到同一个原生课堂，不复制 session。
  const firstOpen = await routes(harness, bench);
  const lessonA = await openLesson(harness, bench, nodeIn(firstOpen, curve.path, '第一课'));
  expect(await openLesson(harness, bench, nodeIn(await routes(harness, bench), curve.path, '第一课'))).toBe(lessonA);

  // 「总结本课」是收课小结，不是隐藏会话：它排一条真实模型回合，而不是客户端提示。
  const beforeIntent = (await harness.turns(lessonA)).length;
  harness.value(await harness.rpc('notaraVault/requestLessonSummary', { input: { sessionId: lessonA } }));
  await harness.waitForTurn(lessonA, beforeIntent);
  const intentTurn = (await harness.turns(lessonA))[beforeIntent];
  const intentText = intentTurn!.messages.filter(message => message.source?.kind === 'user').map(message => message.content.map(block => block.text ?? '').join('')).at(-1) ?? '';
  expect(intentText.length).toBeGreaterThan(0);
  expect(intentText).not.toContain('这节课先到这里');
  // 只有原生归档入口才收起会话；这次小结不把课堂加进归档集合。
  expect(await harness.archivedSessionIds()).not.toContain(lessonA);

  // 有剧本：小结追加到原文，不另建一份小结资料。
  await harness.ask(lessonA, '这节课先到这里，做个课堂小结。', { '这节课先到这里，做个课堂小结。': [{ name: 'save_lesson_summary', arguments: { body: '## 本课进度\n\n从基底讲到坐标表示。\n\n## 下次从这里继续\n\n做一道基底与坐标互相表示的例题。\n' } }] });
  const scriptFile = await harness.readVaultFile('备课/第一课.md');
  expect(scriptFile).toContain('从基底讲到坐标表示');
  expect(scriptFile).toContain('notara:lesson-summary');
  expect(await harness.vaultFiles('lesson_log/')).toEqual([]);

  // 另一条路线插入一节真实课堂，用来区分前课绑定到底读了谁。
  const lessonC = await openLesson(harness, bench, nodeIn(await routes(harness, bench), probability.path, '概率第一课'));
  expect(lessonC).not.toBe(lessonA);
  await harness.ask(lessonC, '概率这节课也做个小结。', { '概率这节课也做个小结。': [{ name: 'save_lesson_summary', arguments: { body: '## 本课进度\n\n从条件出发。\n\n## 下次从这里继续\n\n再练一道条件概率题。\n' } }] });

  // 圆锥曲线第二课读到的必须是第一课的真实小结，而不是另一条路线刚发生的事。
  const lessonB = await openLesson(harness, bench, nodeIn(await routes(harness, bench), curve.path, '第二课'));
  const [bTurn] = await harness.ask(lessonB, '我们开始第二课。', { '我们开始第二课。': '好。' });
  const bWire = JSON.stringify(bTurn);
  expect(bWire).toContain('做一道基底与坐标互相表示的例题');
  expect(bWire).not.toContain('再练一道条件概率题');
  expect(await openLesson(harness, bench, nodeIn(await routes(harness, bench), curve.path, '第二课'))).toBe(lessonB);

  // 无剧本：独立小结资料。概率第一课已经自成一份，这一节只新增自己那一份。
  const before = await harness.vaultFiles('lesson_log/');
  await harness.ask(lessonB, '第二课也到这里，做个小结。', { '第二课也到这里，做个小结。': [{ name: 'save_lesson_summary', arguments: { body: '## 本课进度\n\n第二课：做了坐标例题。\n\n## 下次从这里继续\n\n下次做综合题。\n' } }] });
  const logFiles = await harness.vaultFiles('lesson_log/');
  expect(logFiles).toHaveLength(before.length + 1);
  const freePath = logFiles.find(file => !before.includes(file)) as string;
  expect(await harness.readVaultFile(freePath)).toContain('第二课：做了坐标例题。');
  await harness.ask(lessonB, '又做了一道变式题，补充进小结。', { '又做了一道变式题，补充进小结。': [{ name: 'save_lesson_summary', arguments: { body: '## 本课进度\n\n第二课：坐标例题和一道变式题。\n\n## 下次从这里继续\n\n下次做综合题。\n' } }] });
  const revised = await harness.readVaultFile(freePath);
  expect(revised.match(/<!-- notara:lesson-summary\n/g) ?? []).toHaveLength(1);
  expect(revised).toContain('坐标例题和一道变式题');
  expect(revised).not.toContain('第二课：做了坐标例题。');
  // 修订没有长出新文件，两节课仍各自一份小结资料。
  expect([...(await harness.vaultFiles('lesson_log/'))].sort()).toEqual([...logFiles].sort());

  // 索引指向两次真实课堂的小结块。
  const log = harness.value(await harness.rpc<LessonLogView>('notaraVault/lessonLog', { input: { sessionId: bench } }));
  expect(log.hits.some(hit => hit.path === '备课/第一课.md')).toBe(true);
  expect(log.hits.some(hit => hit.path === freePath)).toBe(true);
  expect(log.hits.every(hit => hit.ref.startsWith('vault:'))).toBe(true);

  // 只做题内小结（没有明确要求归档）不会归档任何一节课。
  expect(await harness.archivedSessionIds()).not.toContain(lessonA);

  // 归档是原生事实：工具报告归档成功的同时，Host 自己的归档列表里确实有这节课。
  await harness.ask(lessonB, '这节课就到这里，请总结并归档。', { '这节课就到这里，请总结并归档。': [{ name: 'save_lesson_summary', arguments: { body: '## 本课进度\n\n第二课完成。\n\n## 下次从这里继续\n\n下次做综合题。\n', archive: true } }] });
  const archivedOutcome = (await harness.outcomes(lessonB)).filter(outcome => outcome.name === 'save_lesson_summary').at(-1);
  expect(archivedOutcome?.failed).toBe(false);
  expect(outcomeJson<SavedSummary>(archivedOutcome!)).toMatchObject({ saved: true, archived: true, path: freePath });
  await expect.poll(async () => harness!.archivedSessionIds(), { timeout: 20_000 }).toContain(lessonB);
  // 归档不吞掉小结：日志仍能定位到这节课真实的最后一次小结块。
  const afterArchive = harness.value(await harness.rpc<LessonLogView>('notaraVault/lessonLog', { input: { sessionId: bench } }));
  expect(afterArchive.hits.find(hit => hit.path === freePath)?.continuation).toContain('下次做综合题');

  // 教法设置：scriptPath 绑定一份已读备课页，null 解除；不是备课页的文件不能被当成剧本。
  // 用一个还没归档的课堂做这件事，避免在小结落点已经核对完之后再改它的绑定。
  await harness.ask(lessonC, '把第一课备课页绑成这节课的剧本。', { '把第一课备课页绑成这节课的剧本。': [{ name: 'set_teaching_settings', arguments: { scriptPath: '备课/第一课.md' } }] });
  const bound = (await harness.outcomes(lessonC)).filter(outcome => outcome.name === 'set_teaching_settings').at(-1);
  expect(bound?.failed).toBe(false);
  expect(outcomeJson<TeachingSettings>(bound!)?.scriptPath).toBe('备课/第一课.md');
  expect(harness.value(await harness.rpc<TeachingSettings>('notaraVault/teachingSettings', { input: { sessionId: lessonC } })).scriptPath).toBe('备课/第一课.md');
  await harness.ask(lessonC, '这条知识笔记不能当剧本。', { '这条知识笔记不能当剧本。': [{ name: 'set_teaching_settings', arguments: { scriptPath: '知识/向量.md' } }] });
  const wrongScript = (await harness.outcomes(lessonC)).filter(outcome => outcome.name === 'set_teaching_settings').at(-1);
  expect(wrongScript?.failed).toBe(true);
  expect(wrongScript?.text).toMatch(/lesson_script_required/);
  await harness.ask(lessonC, '解除这节课的剧本绑定。', { '解除这节课的剧本绑定。': [{ name: 'set_teaching_settings', arguments: { scriptPath: null } }] });
  const unbound = (await harness.outcomes(lessonC)).filter(outcome => outcome.name === 'set_teaching_settings').at(-1);
  expect(unbound?.failed).toBe(false);
  expect(outcomeJson<TeachingSettings>(unbound!)?.scriptPath).toBe(null);
}, 300_000);
