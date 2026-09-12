/**
 * P7 scenario: the model really reads the book, really proposes a skeleton,
 * the student confirms it, and a card authored from the book really points
 * back at the imported immutable version.
 *
 * The old shape of this scenario only checked "no card disagrees", which an
 * empty card list satisfies. It now requires a confirmed `card-create` with at
 * least one real source anchor on the imported material version.
 */
import { expect } from 'vitest';
import {
  liveTest, createLesson, patchCourse, importText, turn, until, proposals, cards, confirmItems, calledTools, value, type LiveClassroom,
} from '../fixtures/live-classroom.ts';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { SkeletonView } from '@studyforge/contracts/skeleton';

const BOOK = [
  '# 函数基础',
  '',
  '## 定义域',
  '求单调区间前先写定义域。',
  '',
  '## 单调性',
  '单调性要在定义域内讨论。',
  '',
  '## 值域',
  '值域是定义域上的所有取值。',
  '',
].join('\n');

function firstOf(proposal: ProposalView, kind: string) {
  const item = proposal.items.find(candidate => candidate.draft.effect.kind === kind);
  if (item === undefined) return undefined;
  return { itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline };
}

async function nextProposal(classroom: LiveClassroom, sessionId: string, kind: string) {
  return until(classroom, `${kind} proposal did not appear`, async () => {
    for (const proposal of await proposals(classroom, sessionId)) {
      const item = firstOf(proposal, kind);
      if (item !== undefined) return { proposal, item };
    }
    return undefined;
  });
}

liveTest('拆书：真实 read_material → propose_skeleton → 确认 → 书节点与原卡回源', async classroom => {
  const book = await importText(classroom, '函数基础', '函数基础.md', BOOK);
  const sessionId = await createLesson(classroom);
  await patchCourse(classroom, sessionId, {
    lessonMaterials: { materials: [{ kind: 'source', source: { materialId: book.materialId, versionId: book.currentVersion.versionId } }] },
  });

  const readTurn = await turn(classroom, sessionId,
    '这是我们今天要用的书，先用 read_material 读它，再用 propose_skeleton 给我一份骨架提案：按书里真实的三节各一个节点，等我确认。');
  const tools = calledTools(readTurn.events);
  expect(tools, classroom.runtime.log()).toContain('read_material');
  expect(tools).toContain('propose_skeleton');

  const skeletonProposal = await nextProposal(classroom, sessionId, 'skeleton-save');
  await confirmItems(classroom, skeletonProposal.proposal, [skeletonProposal.item]);

  const skeleton = value(await classroom.client.rpc<SkeletonView>('studyforgeMaterials/skeleton', { input: { materialId: book.materialId } }));
  expect(skeleton.nodes.length, classroom.runtime.log()).toBeGreaterThanOrEqual(3);
  expect(skeleton.nodes.map(node => node.path).join('|')).toContain('定义域');

  // A card really authored from the book: proposed, confirmed, and anchored.
  await turn(classroom, sessionId,
    '把「定义域」这一节做成一张普通卡：先用 read_material 看这一段的真实行号，再用 propose_card 提议，source 要指到这本书的真实那一段，等我确认。');
  const cardProposal = await nextProposal(classroom, sessionId, 'card-create');
  const confirmed = await confirmItems(classroom, cardProposal.proposal, [cardProposal.item]);
  const applied = confirmed.items.find(item => item.id === cardProposal.item.itemId);
  expect(applied?.status, classroom.runtime.log()).toBe('applied');

  const written = (await cards(classroom)).find(card => card.ref === applied?.receipt?.target);
  expect(written, classroom.runtime.log()).toBeDefined();
  expect(written!.content.sources.length).toBeGreaterThan(0);
  for (const source of written!.content.sources) {
    expect(source.materialId).toBe(book.materialId);
    expect(source.versionId).toBe(book.currentVersion.versionId);
  }
});
