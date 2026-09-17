import { test, expect, enterClassroom, sendInput, openLessonMaterials } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { CardContentSchema, type CardView } from '@studyforge/contracts/cards';
import type { CourseView } from '@studyforge/contracts/courses';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { BookBreakdownIntent, BookStructure } from '@studyforge/contracts/book-exploration';
import { decodeSourceFragments } from '@studyforge/contracts/source-context';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };
type Request = { sessionId: string; purpose: string; toolNames: string[]; messages: { role: string; content: ContentBlock[] }[] };
const textOf = (request: Request) => request.messages.flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : [])).join('\n');

test('chapter task stays in this lesson; proposals attach to its frozen chapter after browsing, confirmation and restart', async ({ page, classroom }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let client = await connectRuntime(classroom);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '先看看这本资料');
  const sessions = async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.filter(s => !s.blank && s.origin !== 'subagent');
  await expect.poll(async () => (await sessions()).length).toBe(1);
  const sessionId = (await sessions())[0]!.sessionId;
  const idle = async () => { await expect.poll(async () => (await sessions()).find(s => s.sessionId === sessionId)?.running).toBe(false); };
  await idle();
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'task-book',
    material: { title: '算术练习', fileName: '算术.md', mediaType: 'text/markdown' }, base64: Buffer.from('计算2+3\n计算7-4\n别的内容\n').toString('base64') } }));
  const material = { materialId: book.materialId, versionId: book.currentVersion.versionId };
  const source = (line: number) => ({ ...material, quote: ['计算2+3', '计算7-4', '别的内容'][line - 1]!,
    locator: { kind: 'text' as const, start: { line, column: 0 }, end: { line, column: line === 3 ? 4 : 5 } } });
  const sources = [source(1), source(2)];
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'task-skeleton', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '算术', sources }, { path: '别处', sources: [source(3)] }] } } }));
  value(await client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId: 'task-existing',
    content: CardContentSchema.parse({ title: '本节已有卡', front: '已收集的题', chapter: '算术', sources: [source(1)] }) } }));
  const before = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  value(await client.rpc('studyforgeCourses/update', { input: { sessionId, operationId: 'task-materials', expectedVersion: before.version,
    patch: { lessonMaterials: { materials: [{ kind: 'source', source: material }] } } } }));
  await writeFile(join(classroom.root, 'book-task-replies.json'), JSON.stringify([{ action: 'cards', nodePath: '算术', calls: [
    ...sources.map(({ quote: _quote, ...source }) => ({ name: 'read_material', arguments: { source } })),
    ...['加法原题', '减法原题'].map((title, i) => ({ name: 'propose_card', arguments: { kind: 'card', title, presentation: 'problem', front: i ? '计算7-4' : '计算2+3', sources: [sources[i]] } })),
  ] }]));
  const requests = async (): Promise<Request[]> => (await readFile(join(classroom.root, 'model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Request).filter(r => r.purpose !== 'session-title');
  let submitted: { sessionId?: string; operationId: string; intent: BookBreakdownIntent } | undefined;
  page.on('request', request => {
    if (request.url().endsWith('/api/studyforgeOrganization/breakdown')) submitted = request.postDataJSON().payload.args.input;
  });
  // Node requests use the same native queue and Steer controls as typed prompts.
  await sendInput(page, '[slow]' + '先保持当前回复。'.repeat(60));
  await expect.poll(async () => (await sessions()).find(s => s.sessionId === sessionId)?.running).toBe(true);
  await openLessonMaterials(page);
  await page.getByTestId('lesson-materials-refresh').click();
  const map = page.getByTestId('lesson-materials-map');
  await map.locator('[data-kind="book"]').getByTestId('mindmap-expand').click();
  const section = map.locator('[data-key$="/section:算术"]');
  await section.getByTestId('lesson-resource-open').click();
  await expect(section).toContainText('1 张题卡');
  await section.getByRole('button', { name: '拆成题卡', exact: true }).click();
  const queue = page.locator('[data-queue-dock]');
  await expect(queue).toContainText('拆成题卡');
  await expect(queue).not.toContainText('studyforge-source');
  await expect(queue).not.toContainText('materialId');
  expect(value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }))).toHaveLength(0);
  await queue.getByRole('button', { name: 'Steer queued message', exact: true }).click();
  await expect(queue).toBeHidden();
  await expect(page.locator('[data-conversation-scroll]')).not.toContainText('studyforge-source');
  await expect.poll(async () => value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } })).length).toBe(2);
  await idle();
  expect(submitted).toMatchObject({ sessionId, intent: { action: 'cards', nodePath: '算术', sources } });
  expect(await sessions()).toHaveLength(1);
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).data.teachingRef).toBe(before.data.teachingRef);
  const taskRequest = (await requests()).find(r => textOf(r).includes('本次节点操作：拆成题卡'))!;
  expect(taskRequest.sessionId).toBe(sessionId);
  // Progressive disclosure: the request tools stay at the core set while
  // delegation lives in the deferred catalogue the task instructions cite.
  expect(taskRequest.toolNames).toContain('load_tools');
  expect(textOf(taskRequest)).toContain('本节已有卡');
  const instructions = taskRequest.messages.findLast(m => m.role === 'system')!.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n');
  expect(textOf(taskRequest)).toContain('subagent');
  expect(instructions).toContain('# 资料整理');
  expect(instructions).not.toContain('# 苏格拉底授课');
  const taskFragment = taskRequest.messages.flatMap(m => m.role === 'user' ? m.content.flatMap(b => b.type === 'text' ? decodeSourceFragments(b.text).fragments : []) : []).find(f => f.bookTask);
  expect(taskFragment?.bookTask).toMatchObject({ action: 'cards', nodePath: '算术', sources });
  const cards = async () => value(await client.rpc<CardView[]>('studyforgeLearning/cards', {}));
  expect(await cards()).toHaveLength(1);
  const pending = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }));
  for (const proposal of pending) expect(proposal.items[0]).toMatchObject({ status: 'pending', draft: { effect: { kind: 'card-create', content: { chapter: '算术' } } } });
  await map.locator('[data-key$="/section:别处"]').getByTestId('lesson-resource-open').click();
  const proposals = page.getByTestId('inline-proposal');
  await expect(proposals).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('chapter-task-pending.png'), fullPage: true });
  for (const title of ['加法原题', '减法原题']) {
    const proposal = proposals.filter({ hasText: title });
    await proposal.getByTestId('proposal-confirm').click();
    await expect(proposal.locator('summary')).toContainText('已经保存');
    await idle();
  }
  await expect(section).toContainText('3 张题卡');
  const saved = (await cards()).filter(card => card.content.title !== '本节已有卡');
  expect(saved).toHaveLength(2);
  for (const card of saved) { expect(card.content.chapter).toBe('算术'); expect(card.history).toEqual([]); expect(card).not.toHaveProperty('review'); }
  const count = (await requests()).length;
  value(await client.rpc('studyforgeOrganization/breakdown', { input: submitted }));
  await idle();
  expect((await requests()).length).toBe(count);
  expect(value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }))).toHaveLength(2);
  await page.getByRole('navigation', { name: '工作台中打开的内容' }).getByRole('button', { name: '关系图', exact: true }).click();
  await expect(section).toBeVisible();
  await page.screenshot({ path: info.outputPath('chapter-task-saved.png'), fullPage: true });
  // Restart the isolated host to discard every process-local attempt counter.
  await classroom.restart(); client = await connectRuntime(classroom);
  value(await client.rpc('studyforgeOrganization/breakdown', { input: submitted }));
  await idle();
  expect((await requests()).length).toBe(count);
  await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: /一次函数学习/ }).click();
  await openLessonMaterials(page);
  await expect(map.locator('[data-kind="book"]').first()).toBeVisible();
  await map.locator('[data-kind="book"]').first().getByTestId('mindmap-expand').click();
  await section.getByTestId('mindmap-expand').click();
  await map.locator('[data-kind="card"]').filter({ hasText: '加法原题' }).getByTestId('lesson-resource-open').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('加法原题');
  await page.locator('[data-pane="card"]').getByTestId('card-detail-source-open').click();
  await expect(page.getByTestId('source-highlight').first()).toBeVisible();
  const tree = value(await client.rpc<BookStructure>('studyforgeOrganization/book', { input: { sessionId, material } }));
  for (const card of saved) expect(tree.nodes.find(n => n.key === card.ref)?.parentKey).toBe('section:算术');
  // A new ordinary message ends the temporary task, including after restart.
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'propose_card', arguments: { kind: 'card', title: '另一个问题', front: '不是本节拆卡' } }));
  await expect.poll(async () => value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } })).length).toBe(3);
  await idle();
  const ordinary = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } })).find(p => p.title === '另一个问题')!;
  expect(ordinary.items[0]?.draft.effect).toMatchObject({ kind: 'card-create', content: { title: '另一个问题', sources: [] } });
  expect(ordinary.items[0]?.draft.effect).not.toHaveProperty('content.chapter');
  const restored = (await requests()).at(-1)!.messages.findLast(m => m.role === 'system')!.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n');
  expect(restored).toContain('# 苏格拉底授课');
  expect(restored).not.toContain('本次节点操作');
  expect(errors).toEqual([]);
});
