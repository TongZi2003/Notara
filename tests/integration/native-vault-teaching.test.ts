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
 * The main classroom ships no native text-file rows: `read`/`write`/`edit`/
 * `glob`/`grep` are hidden from the teacher's request and refused by the
 * registry guard, while delegation children keep their own read-only surface
 * (owned by native-vault-solver.test.ts). The teacher reads and searches by
 * combining native Bash (`ls`/`rg`/`grep`/`sed`) and saves Vault Markdown
 * through the bundled command line (`write-batch`); `read_image`, `skill`, the
 * PDF command and the four lifecycle operations stay. Bash inherits the native
 * sandbox and approval decision — the teaching layer adds no uniform approval
 * and never guesses read-only from command text. These cases own that non-UI
 * runtime contract: settings→request assembly, Bash reads, native version CAS
 * through the command line, route session identity and the summary/archive path.
 *
 * The learner-facing surface (composer, settings dialog, route bench, canvas
 * controls) is validated in the Playwright lane.
 */
import { afterEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated, type VaultRuntime } from '../../scripts/dev-isolated.ts';
import { connectVault, effectiveSystemText, outcomeJson, skillNames, toolNames, toolResultTexts, type ScriptedCall, type VaultHarness } from '../fixtures/vault-http.ts';

interface TeachingChoice { id: string; title: string; description: string }
interface TeachingSettings {
  revision: number;
  teachingRef: string;
  persona: string;
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
/** Native rows the main classroom must actually offer in the assembled request:
 * Bash carries reading, searching and the deterministic commands, image reading
 * and Skills stay rows of their own. */
const TEACHER_NATIVE_TOOL_NAMES = ['bash', 'read_image', 'skill'];
/** Native text-file rows the main classroom hides AND refuses. The teacher reads
 * and searches through Bash and saves through the command line instead; a
 * delegation child keeps its own surface and is not covered by this rule. */
const HIDDEN_NATIVE_TOOL_NAMES = ['read', 'write', 'edit', 'glob', 'grep'];
/** Retired classroom tools: none of them is callable, offered or kept as a
 * compatibility shape, so a caller can never be pulled back onto the old surface. */
const RETIRED_TOOL_NAMES = ['vault_list', 'vault_read', 'vault_search', 'vault_save', 'learning_find', 'learning_read', 'lesson_log_find', 'create_learning_route', 'review_queue', 'record_review', 'learning_calendar', 'schedule_learning_lesson'];

/** The Vault's own content revision: sha256 of the Markdown text, first 24 hex. */
const revisionOf = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 24);
/** One scripted call per hidden native text tool, so the guard is exercised by
 * tool name instead of by an absent schema entry. */
const HIDDEN_CALLS: Record<string, ScriptedCall> = {
  write: { name: 'write', arguments: { file_path: 'vault/卡片/治理回归.md', content: '---\ntype: card\n---\n# 治理回归\n\n只有 Bash 与命令行才落盘。\n' } },
  read: { name: 'read', arguments: { file_path: 'vault/知识/向量.md' } },
  glob: { name: 'glob', arguments: { pattern: 'vault/**/*.md' } },
  grep: { name: 'grep', arguments: { pattern: '向量', path: 'vault/知识', include: '*.md' } },
  edit: { name: 'edit', arguments: { file_path: 'vault/知识/向量.md', old_string: '向量既可以用代数坐标表示', new_string: '模型改写的正文' } },
};
interface BatchEntry { path: string; op: string; saved: boolean; revision?: string; error?: { code: string; message: string; next: string } }
interface BatchPayload { ok: boolean; command: string; result?: { results: BatchEntry[]; savedCount: number; failedCount: number } }

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

/** One Bash turn the teacher actually runs: the command as scripted, its real
 * tool result, the native approval prompts it produced, and the requests it
 * assembled. Comparing the per-turn approval delta is how "the teaching layer
 * adds no uniform Bash approval" is measured instead of asserted in prose. */
async function askBash(client: VaultHarness, sessionId: string, text: string, command: string, intent: string) {
  const before = client.approvals.seen.length;
  const turns = await client.ask(sessionId, text, { [text]: [{ name: 'bash', arguments: { command, description: `[notara:${intent}] ${text}` } }] });
  const outcome = (await client.outcomes(sessionId)).filter(row => row.name === 'bash').at(-1);
  return { turns, outcome, approvals: client.approvals.seen.length - before };
}
/** The exact Bash line the teacher runs for one `write-batch` payload. */
const batchCommand = (files: unknown[]): string => `printf '%s' '${JSON.stringify({ files })}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" write-batch`;

test('教学设置进入真实装配请求，同课切教法改变下一次请求，重启冷恢复且不串普通课', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();

  // 首次发送前的设置：默认教法来自 Host 自己的目录，不是客户端写死的一份名单。
  const initial = harness.value(await harness.rpc<TeachingSettings>('notaraVault/teachingSettings', { input: { sessionId } }));
  expect(initial).toMatchObject({ revision: 0, teachingRef: 'socratic', persona: '', learningGoal: null, temporaryInstructions: '', subjects: [] });
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
  // 教学预设真实挂载：四个课堂生命周期工具＋原生 Bash、读图与技能工具。
  expect(toolNames(firstTurn!)).toEqual(expect.arrayContaining([...NOTARA_TOOL_NAMES, ...TEACHER_NATIVE_TOOL_NAMES]));
  // 主课堂没有原生文本文件工具：读写走 Bash 与 write-batch，不再挂 read/write/edit/glob/grep。
  for (const name of HIDDEN_NATIVE_TOOL_NAMES) expect(toolNames(firstTurn!), `主课堂仍挂着原生文本工具 ${name}`).not.toContain(name);
  // write-batch 是命令行命令，不是模型工具：工具面里不会出现同名模型工具。
  expect(toolNames(firstTurn!).filter(name => /write[-_]?batch/i.test(name))).toEqual([]);
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

  // 人格：默认请求用 Host 自己的默认教学形象；改成自定义中文老师名之后，下一次真实
  // 请求换成自定义人格、不再带默认形象，冷恢复之后仍是自定义人格。
  expect(effectiveSystemText(firstTurn!)).toContain('大肥鱼');
  harness.value(await harness.rpc('notaraVault/updateTeachingSettings', { input: { sessionId, expectedRevision: 2, patch: { persona: '王老师' } } }));
  const [personaTurn] = await harness.ask(sessionId, '换个称呼继续讲。', { '换个称呼继续讲。': '好，我继续。' });
  expect(effectiveSystemText(personaTurn!)).toContain('王老师');
  expect(effectiveSystemText(personaTurn!)).not.toContain('大肥鱼');
  await runtime.restart();
  harness = await connectVault(runtime);
  expect(harness.value(await harness.rpc<TeachingSettings>('notaraVault/teachingSettings', { input: { sessionId } })).persona).toBe('王老师');
  const [afterPersonaTurn] = await harness.ask(sessionId, '恢复之后再继续。', { '恢复之后再继续。': '继续。' });
  expect(effectiveSystemText(afterPersonaTurn!)).toContain('王老师');
  expect(effectiveSystemText(afterPersonaTurn!)).not.toContain('大肥鱼');

  // 普通预设：没有教学技能，没有课堂生命周期工具，退役工具同样不存在。
  const plain = await harness.createSession('standard');
  const [plainTurn] = await harness.ask(plain, '给我讲讲什么是向量。', { '给我讲讲什么是向量。': '向量可以看成……' });
  expect(plainTurn!.messages.some(message => message.source?.kind === 'user' && message.content.some(block => block.text === '给我讲讲什么是向量。'))).toBe(true);
  expect(skillNames(plainTurn!).filter(name => name.startsWith('notara-'))).toEqual([]);
  // 普通编码预设不变：原生文本工具照旧挂载，只是没有课堂工具与教学技能。
  expect(toolNames(plainTurn!)).toEqual(expect.arrayContaining(['read', 'write', 'edit', 'glob', 'grep', 'bash', 'skill']));
  for (const name of [...NOTARA_TOOL_NAMES, ...RETIRED_TOOL_NAMES]) expect(toolNames(plainTurn!)).not.toContain(name);
}, 300_000);

test('主教师用原生 Bash 组合 ls/grep/sed 读取检索，PDF 仍走命令行，且不整库注入', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();

  // 目录用原生 ls：只给真实路径，不把整库正文带进来。
  const list = await askBash(harness, sessionId, '这个课堂里现在都有哪些资料？', 'ls -1 vault/知识/*.md vault/路线/*.md', 'material-read');
  expect(list.outcome?.failed).toBe(false);
  expect(list.outcome?.text).toContain('vault/知识/向量.md');
  expect(list.outcome?.text).toContain('vault/路线/向量路线.md');
  expect(list.outcome?.text).not.toContain('向量既可以用代数坐标表示');
  // 目录结果就是模型真拿到的那份文本，不是测试自己拼的清单。
  expect(toolResultTexts(list.turns.at(-1)!).join('\n')).toContain('vault/知识/向量.md');

  // 不给文件名也能搜到候选：正文检索走原生 grep，候选带真实路径与命中行。
  const search = await askBash(harness, sessionId, '有没有讲向量的资料？', "grep -rn '向量' vault/知识", 'material-read');
  expect(search.outcome?.failed).toBe(false);
  expect(search.outcome?.text).toContain('vault/知识/向量.md');
  // 原生 grep 的行格式是 path:line:正文，第二个冒号后直接接正文，没有多余空格。
  expect(search.outcome?.text).toMatch(/^vault\/知识\/向量\.md:\d+:.*向量/m);

  // 正文按需用原生 sed 读：拿到真实文件内容，而不是整库摘要。
  const body = await askBash(harness, sessionId, '知识库里的向量笔记正文读给我。', "sed -n '1,60p' vault/知识/向量.md", 'material-read');
  expect(body.outcome?.failed).toBe(false);
  expect(body.outcome?.text).toContain('# 向量');
  expect(body.outcome?.text).toContain('向量既可以用代数坐标表示');
  expect(toolResultTexts(body.turns.at(-1)!).join('\n')).toContain('向量既可以用代数坐标表示');

  // PDF 按页读走课堂自带的命令行：真实页文本、真实 revision 和一张真实页图。
  const pdfCommand = `printf '%s' '{"path":"媒体/向量讲义.pdf","page":2}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" pdf-page`;
  const pdf = await askBash(harness, sessionId, '读一下向量讲义第2页的内容。', pdfCommand, 'material-read');
  expect(pdf.outcome?.failed).toBe(false);
  const page = commandJson<{ ok: boolean; command: string; result: { path: string; page: number; pageCount: number; text: string; revision: string; imagePath: string } }>(pdf.outcome!.text);
  expect(page.ok).toBe(true);
  expect(page.command).toBe('pdf-page');
  expect(page.result.path).toContain('向量讲义.pdf');
  expect(page.result.page).toBe(2);
  expect(page.result.text).toContain('A point can be described by its coordinates.');
  expect(page.result.revision).toMatch(/^[0-9a-f]{24}$/);
  // 页图是真实落盘的图片文件；模型的多模态读图能力未验证，这里不为它下结论。
  const pageImage = await readFile(page.result.imagePath);
  expect(pageImage.length).toBeGreaterThan(1000);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
  expect(pageImage.subarray(0, 4).equals(pngMagic) || pageImage.subarray(0, 3).equals(jpegMagic)).toBe(true);
  // 页文本随工具结果进入下一次真实请求。
  expect(toolResultTexts(pdf.turns.at(-1)!).join('\n')).toContain('A point can be described by its coordinates.');

  // Bash 沿原生沙箱与审批：教学层不为 Bash 统一追加审批，也不按命令文本猜只读，
  // 所以这里比较每条命令各自的原生审批增量，而不是固定断言“永远零次”。
  expect(search.approvals).toBe(list.approvals);
  expect(body.approvals).toBe(list.approvals);
  expect(pdf.approvals).toBe(list.approvals);
}, 300_000);

test('主教师的原生文本工具被隐藏并拒绝：不落盘不注入，完全权限也不解锁', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();

  // 隐藏的工具被真调用时由治理层拒绝：五条调用拿到同一条说明，都不是假成功。
  const ask = '把这些文件操作用原生文本工具都做一遍。';
  const before = (await harness.outcomes(sessionId)).length;
  await harness.ask(sessionId, ask, { [ask]: HIDDEN_NATIVE_TOOL_NAMES.map(name => HIDDEN_CALLS[name]!) });
  const guarded = (await harness.outcomes(sessionId)).slice(before);
  expect(guarded.map(row => row.name)).toEqual(HIDDEN_NATIVE_TOOL_NAMES);
  expect(guarded.every(row => row.failed), guarded.map(row => `${row.name}: ${row.text}`).join('\n')).toBe(true);
  expect(new Set(guarded.map(row => row.text)).size).toBe(1);
  expect(guarded[0]?.text).toContain('bash');
  // 旧的 write/edit 批准通路已退役：被隐藏的调用不再进入原生批准面板。
  expect(harness.approvals.seen).toHaveLength(0);
  // 不落盘、不改写；被拒绝的读也没有把正文带进请求。
  expect(await harness.vaultExists('卡片/治理回归.md')).toBe(false);
  const note = await harness.readVaultFile('知识/向量.md');
  expect(note).toContain('向量既可以用代数坐标表示');
  expect(note).not.toContain('模型改写的正文');
  const rejectedResults = toolResultTexts((await harness.turns(sessionId)).at(-1)!).join('\n');
  expect(rejectedResults).not.toContain('只有 Bash 与命令行才落盘');
  expect(rejectedResults).not.toContain('向量既可以用代数坐标表示');

  // 完全权限也不解锁：隐藏与拒绝是治理层规则，不是权限档位。
  const switched = harness.value(await harness.rpc<{ result: { kind: string } }>('commands/execute', { agentId: sessionId, line: '/permission danger-full-access', submittedAttachments: [] }));
  expect(switched.result.kind).not.toBe('error');
  const fullAsk = '现在是完全权限，再试一次这些原生文本工具。';
  const beforeFull = (await harness.outcomes(sessionId)).length;
  await harness.ask(sessionId, fullAsk, { [fullAsk]: HIDDEN_NATIVE_TOOL_NAMES.map(name => HIDDEN_CALLS[name]!) });
  const full = (await harness.outcomes(sessionId)).slice(beforeFull);
  expect(full.every(row => row.failed), full.map(row => `${row.name}: ${row.text}`).join('\n')).toBe(true);
  expect(await harness.vaultExists('卡片/治理回归.md')).toBe(false);
  expect(await harness.readVaultFile('知识/向量.md')).toBe(note);
}, 300_000);

test('主教师写入走 CLI write-batch：create 拒绝覆盖、edit 唯一匹配、CAS revision、部分失败非零且只重试失败项', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();
  const notePath = '知识/向量.md';
  const noteBefore = await harness.readVaultFile(notePath);
  const oldText = '向量既可以用代数坐标表示，也可以用几何方向表示。';
  const newText = '向量既可以用代数坐标表示，也可以用几何方向表示。补一句：坐标依赖所选的基底。';
  const cardText = '---\ntype: card\n---\n# 例\n\n基底把几何问题翻译成坐标。\n';
  expect(noteBefore).toContain(oldText);

  // 一次 Bash 调用里两项都成功：回执是命令自己的 JSON，没有失败退出。
  const first = await askBash(harness, sessionId, '把这两处改动一起保存。', batchCommand([
    { op: 'create', path: '卡片/例.md', content: cardText },
    { op: 'edit', path: notePath, oldText, newText },
  ]), 'note-write');
  expect(first.outcome?.failed).toBe(false);
  expect(first.outcome?.text).not.toMatch(/\[exit code:/);
  const receipt = commandJson<BatchPayload>(first.outcome!.text);
  expect(receipt).toMatchObject({ ok: true, command: 'write-batch' });
  expect(receipt.result).toMatchObject({ savedCount: 2, failedCount: 0 });

  // 两项都真实落盘；回执里的 revision 就是这两份文件当前的真实版本。
  const card = await harness.readVaultFile('卡片/例.md');
  expect(card).toBe(cardText);
  const note = await harness.readVaultFile(notePath);
  // edit 只替换唯一命中的那一处，其余内容原样保留。
  expect(note).toBe(noteBefore.replace(oldText, newText));
  expect(receipt.result?.results.find(row => row.op === 'create')).toMatchObject({ path: '卡片/例.md', saved: true, revision: revisionOf(card) });
  expect(receipt.result?.results.find(row => row.op === 'edit')).toMatchObject({ path: notePath, saved: true, revision: revisionOf(note) });
  expect(toolResultTexts(first.turns.at(-1)!).join('\n')).toContain('write-batch');

  // 部分失败：create 撞上已有文件被拒绝，同批的另一项照常保存；整批非零退出。
  const second = await askBash(harness, sessionId, '再存两张卡片。', batchCommand([
    { op: 'create', path: '卡片/例.md', content: '---\ntype: card\n---\n# 覆盖\n\n不该覆盖已存在的卡片。\n' },
    { op: 'create', path: '卡片/新例.md', content: '---\ntype: card\n---\n# 新例\n\n同一批里的新文件照常保存。\n' },
  ]), 'note-write');
  expect(second.outcome?.text).toMatch(/\[exit code: 1\]/);
  const partial = commandJson<BatchPayload>(second.outcome!.text);
  expect(partial.ok).toBe(false);
  expect(partial.result).toMatchObject({ savedCount: 1, failedCount: 1 });
  const refused = partial.result!.results.find(row => row.saved === false)!;
  expect(refused).toMatchObject({ path: '卡片/例.md', op: 'create', saved: false, error: { code: 'vault_revision_conflict' } });
  expect(typeof refused.error?.message).toBe('string');
  expect(typeof refused.error?.next).toBe('string');
  // 已成功的保留、被拒绝的没有覆盖。
  expect(await harness.readVaultFile('卡片/例.md')).toBe(card);
  expect(await harness.readVaultFile('卡片/新例.md')).toContain('同一批里的新文件照常保存。');

  // 原文不唯一（外部改动后按旧读结果写）时拒绝，且不改动文件；只重试失败项。
  const staleText = `${oldText}（旧版补记）。`;
  const afterExternal = `${note}\n${staleText}\n`;
  await harness.writeVaultFile(notePath, afterExternal);
  const third = await askBash(harness, sessionId, '按刚才读到的原文改一处。', batchCommand([{ op: 'edit', path: notePath, oldText, newText: '模型改写的正文' }]), 'note-write');
  expect(third.outcome?.text).toMatch(/\[exit code: 1\]/);
  const mismatched = commandJson<BatchPayload>(third.outcome!.text);
  expect(mismatched.result?.results[0]).toMatchObject({ path: notePath, op: 'edit', saved: false, error: { code: 'batch_original_mismatch' } });
  expect(await harness.readVaultFile(notePath)).toBe(afterExternal);

  const retry = await askBash(harness, sessionId, '改成唯一匹配的原文再保存。', batchCommand([{ op: 'edit', path: notePath, oldText: `${staleText}\n`, newText: '第二处已核对。\n' }]), 'note-write');
  expect(retry.outcome?.text).not.toMatch(/\[exit code:/);
  expect(commandJson<BatchPayload>(retry.outcome!.text).result?.savedCount).toBe(1);
  const noteAfter = await harness.readVaultFile(notePath);
  expect(noteAfter).toContain('第二处已核对');
  expect(noteAfter).toContain('## 关键联系');
  expect(noteAfter).toContain('[[路线/向量路线]]');
  // 只重试失败项：先前成功的卡片没有被再写一遍。
  expect(revisionOf(await harness.readVaultFile('卡片/例.md'))).toBe(receipt.result?.results.find(row => row.path === '卡片/例.md')?.revision);
  expect(await harness.readVaultFile('卡片/新例.md')).toContain('同一批里的新文件照常保存。');

  // 超过 50 个不同路径的批次在写入前整批拒绝，不留半批结果。
  const overflow = await askBash(harness, sessionId, '一次性建很多卡片。', batchCommand(Array.from({ length: 51 }, (_, index) => ({ op: 'create', path: `卡片/批量-${index}.md`, content: `---\ntype: card\n---\n# 批量 ${index}\n` }))), 'note-write');
  expect(overflow.outcome?.text).toMatch(/\[exit code: [1-9]\d*\]/);
  expect(commandJson<BatchPayload>(overflow.outcome!.text)).toMatchObject({ ok: false });
  expect((await harness.vaultFiles('卡片/')).filter(path => path.includes('批量-'))).toEqual([]);

  // Bash 沿用原生沙箱与审批：教学层不按命令内容另设分类，写入命令的审批增量与只读命令一致。
  const readOnly = await askBash(harness, sessionId, '先列一下知识目录。', 'ls -1 vault/知识/*.md', 'material-read');
  expect(first.approvals).toBe(readOnly.approvals);
  expect(second.approvals).toBe(readOnly.approvals);
}, 300_000);

test('课堂写工具的拒绝保持真实：专用小结工具被拒绝时不落盘、不留成功文案', async () => {
  runtime = await startVaultIsolated({ testModel: true });
  harness = await connectVault(runtime);
  const sessionId = await harness.createSession();
  const before = await harness.vaultFiles('lesson_log/');

  // 专用写工具仍走原生批准；用户拒绝之后必须如实失败，而不是留下“已保存”的假象。
  harness.approvals.answer('rejected');
  const ask = '这节课先到这里，做个课堂小结。';
  await harness.ask(sessionId, ask, { [ask]: [{ name: 'save_lesson_summary', arguments: { body: '## 本课进度\n\n从基底讲到坐标表示。\n\n## 下次从这里继续\n\n做一道基底与坐标互相表示的例题。\n' } }] });
  const outcome = (await harness.outcomes(sessionId)).filter(row => row.name === 'save_lesson_summary').at(-1);
  expect(harness.approvals.seen.map(prompt => prompt.toolName)).toContain('save_lesson_summary');
  expect(outcome?.failed).toBe(true);
  expect(outcome?.text).toMatch(/reject|拒绝/i);
  expect(outcomeJson(outcome!)).toBeUndefined();
  expect(await harness.vaultFiles('lesson_log/')).toEqual(before);
  expect((await harness.vaultFiles()).some(file => file.includes('基底讲到坐标表示'))).toBe(false);
}, 120_000);

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
