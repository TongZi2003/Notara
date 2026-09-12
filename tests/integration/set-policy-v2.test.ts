/**
 * P6.1 learning sets against the real record store (plan §P6.1, CONTRACTS.md §5).
 *
 * Every set and card here is a real RecordStore row, and a ladder/material
 * change is published by the production `owner.atomic` the Host wires. The
 * properties under test are the ones the product depends on: a set names the
 * originals it groups, where a card belongs is derived from those originals
 * union explicit membership (no second material→set ledger), the effective
 * ladder is the shortest one by (last step, step count, lexicographic), a card
 * that belongs to no set is visible everywhere with the default ladder,
 * renaming a set moves nothing, and one ladder/material move rewrites only due
 * dates — never history, never an activation.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import { SetRecordSchema } from '../../packages/contracts/src/sets.ts';
import { DEFAULT_LADDER } from '../../packages/contracts/src/reviews.ts';
import type { HostContext } from '../../packages/contracts/src/execution.ts';
import type { SourceAnchor } from '../../packages/contracts/src/materials.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { SetService, type MaterialRefs } from '../../packages/domain/src/organization/set-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const student = (operationId: string, expectedVersion?: number) =>
  ({ ...HOST, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });

/** A real material id shape (`mat_` + 16 lowercase/digit chars). */
const mat = (letter: string) => 'mat_' + letter.repeat(16);
const MAT_A = mat('a');
const MAT_B = mat('b');
const UNKNOWN = mat('z');

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function open(root?: string, wirePublisher = true) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-set-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const setStore = await owner.collection('set', SetRecordSchema);
  const cardStore = await owner.collection('card', CardRecordSchema);
  // The Host side: only existence of an original — never a material→set mapping.
  const known = new Set<string>();
  const materials: MaterialRefs = { hasMaterial: (_ctx, materialId) => Promise.resolve(known.has(materialId)) };
  const publications: string[][] = [];
  const publish = {
    atomic: async (changes: Parameters<typeof owner.atomic>[0]) => {
      publications.push(changes.map(change => change.kind));
      await owner.atomic(changes);
    },
  };
  const sets = new SetService(setStore, cardStore, materials, clock, wirePublisher ? publish : undefined);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { dir, owner, setStore, cardStore, known, publications, sets };
}

type Workspace = Awaited<ReturnType<typeof open>>;

const anchor = (materialId: string): SourceAnchor => ({
  materialId, versionId: `ver_${materialId}`, locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
});

async function makeCard(workspace: Workspace, id: string, sources: SourceAnchor[] = [], review?: { lastAccessed: string; nextDue: string; reviewCount: number }) {
  const saved = await workspace.cardStore.create(student(`card-${id}`), id, {
    content: { title: id, front: 'x', sources }, history: [], ...(review === undefined ? {} : { review }),
  });
  return saved;
}

test('a set is created by operation, listed by name, and renaming moves nothing', async () => {
  const workspace = await open();
  const { sets, cardStore } = workspace;
  const second = await sets.create(student('set-b'), { name: 'B-复习' });
  const first = await sets.create(student('set-a'), { name: 'A-数学', subjects: ['数学'], ladder: [1, 3, 7] });
  expect(sets.list(HOST).map(view => view.name)).toEqual(['A-数学', 'B-复习']);
  // The same operation is one effect, not a second set.
  expect((await sets.create(student('set-a'), { name: 'A-数学', subjects: ['数学'], ladder: [1, 3, 7] })).ref).toBe(first.ref);
  expect(workspace.setStore.list(HOST)).toHaveLength(2);
  expect(first.materials).toEqual([]);

  // A ladder that is not 2–12 strictly increasing steps from 1 is refused.
  await expect(sets.create(student('set-bad'), { name: 'A-坏梯', ladder: [3, 7] })).rejects.toThrow();
  await expect(sets.create(student('set-bad2'), { name: 'A-坏梯', ladder: [1, 3, 3] })).rejects.toThrow();
  // A set may only group originals this workspace really holds.
  await expect(sets.create(student('set-ghost'), { name: 'A-野材料', materials: [UNKNOWN] }))
    .rejects.toMatchObject({ code: 'set_material_unresolved', problems: [UNKNOWN] });

  const card = await makeCard(workspace, 'member-card');
  await sets.update(student('member', 1), first.ref, { members_add: [card.ref] });
  const renamed = await sets.update(student('rename', 2), first.ref, { name: 'A-新名字' });
  expect(renamed.ref).toBe(first.ref);
  expect(renamed.version).toBe(3);
  expect(renamed.members).toEqual([card.ref]);
  expect(cardStore.read(HOST, card.ref).version).toBe(1);
  // The name is taken by another set; covering it would silently re-home cards.
  await expect(sets.update(student('dup', 3), first.ref, { name: 'B-复习' })).rejects.toMatchObject({ code: 'set_name_exists' });
  expect((await sets.ownership(HOST, card.ref)).map(view => view.ref)).toEqual([renamed.ref]);
  expect(second.name).toBe('B-复习');
});

test('a member must be a real card, and membership moves by increment', async () => {
  const workspace = await open();
  const { sets } = workspace;
  const set = await sets.create(student('set'), { name: 'A-集' });
  const card = await makeCard(workspace, 'card-1');
  await expect(sets.update(student('bad', 1), set.ref, { members_add: ['card:ghost'] }))
    .rejects.toMatchObject({ code: 'set_member_unresolved', problems: ['card:ghost'] });
  const added = await sets.update(student('add', 1), set.ref, { members_add: [card.ref] });
  expect(added.members).toEqual([card.ref]);
  expect((await sets.ownership(HOST, card.ref)).map(view => view.ref)).toEqual([set.ref]);
  const removed = await sets.update(student('remove', 2), set.ref, { members_remove: [card.ref] });
  expect(removed.members).toEqual([]);
  // No set means no ownership, and that is a legal state, not a hidden set.
  expect(await sets.ownership(HOST, card.ref)).toEqual([]);
  expect(await sets.effectiveLadder(HOST, card.ref)).toEqual([...DEFAULT_LADDER]);
  // A card sourced from an original no set groups stays unowned.
  const ghost = await makeCard(workspace, 'ghost-card', [anchor(UNKNOWN)]);
  expect(await sets.ownership(HOST, ghost.ref)).toEqual([]);
});

test('derived ownership comes from the originals a set groups, union explicit membership', async () => {
  const workspace = await open();
  const { sets, known } = workspace;
  known.add(MAT_B);
  const bookSet = await sets.create(student('set-book'), { name: 'A-书集', materials: [MAT_B] });
  const memberSet = await sets.create(student('set-member'), { name: 'B-成员集' });
  const card = await makeCard(workspace, 'derived', [anchor(MAT_B)]);
  expect(bookSet.materials).toEqual([MAT_B]);
  expect((await sets.ownership(HOST, card.ref)).map(view => view.name)).toEqual(['A-书集']);
  await sets.update(student('member', 1), memberSet.ref, { members_add: [card.ref] });
  expect((await sets.ownership(HOST, card.ref)).map(view => view.name)).toEqual(['A-书集', 'B-成员集']);
  // The same card is one row in each owning set's own list, and only those.
  expect(await sets.cardsOf(HOST, bookSet.ref)).toEqual([card.ref]);
  expect(await sets.cardsOf(HOST, memberSet.ref)).toEqual([card.ref]);
});

test('the effective ladder is the shortest one: last step, step count, then lexicographic', async () => {
  const workspace = await open();
  const { sets, known } = workspace;
  known.add(MAT_A);
  const wide = await sets.create(student('wide'), { name: 'A-wide', ladder: [1, 3, 9, 20], materials: [MAT_A] });
  const short = await sets.create(student('short'), { name: 'B-short', ladder: [1, 4, 9], materials: [MAT_A] });
  expect(await sets.cardsOf(HOST, wide.ref)).toEqual([]);
  const card = await makeCard(workspace, 'both', [anchor(MAT_A)]);
  // Same last step (9): fewer steps wins.
  expect(await sets.effectiveLadder(HOST, card.ref)).toEqual([1, 4, 9]);
  expect((await sets.ownership(HOST, card.ref)).map(view => view.name)).toEqual(['A-wide', 'B-short']);

  known.add(MAT_B);
  const lexA = await sets.create(student('lex-a'), { name: 'C-lex', ladder: [1, 2, 5], materials: [MAT_B] });
  const lexB = await sets.create(student('lex-b'), { name: 'D-lex', ladder: [1, 4, 5], materials: [MAT_B] });
  const tied = await makeCard(workspace, 'tied', [anchor(MAT_B)]);
  // Same last step and same length: lexicographic, never a sum.
  expect(await sets.effectiveLadder(HOST, tied.ref)).toEqual([1, 2, 5]);
  expect([lexA.ref, lexB.ref]).toContain((await sets.ownership(HOST, tied.ref))[0]!.ref);
  // The rule is not a sum: a ladder whose sum is far smaller but whose last step
  // is longer loses to the one that finishes sooner.
  known.add(mat('c'));
  const many = await sets.create(student('many'), { name: 'F-many', ladder: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], materials: [mat('c')] });
  const sparse = await sets.create(student('sparse'), { name: 'G-sparse', ladder: [1, 20], materials: [mat('c')] });
  const sumCard = await makeCard(workspace, 'sum-card', [anchor(mat('c'))]);
  expect(await sets.effectiveLadder(HOST, sumCard.ref)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect([many.ref, sparse.ref]).toContain((await sets.ownership(HOST, sumCard.ref))[1]!.ref);

  // A set with no policy of its own contributes nothing.
  known.add(mat('d'));
  const bare = await sets.create(student('bare'), { name: 'E-bare', materials: [mat('d')] });
  const bareCard = await makeCard(workspace, 'bare-card', [anchor(mat('d'))]);
  expect((await sets.ownership(HOST, bareCard.ref)).map(view => view.ref)).toEqual([bare.ref]);
  expect(await sets.effectiveLadder(HOST, bareCard.ref)).toEqual([...DEFAULT_LADDER]);
});

test('a ladder change refits only due dates, published with the set in one atomic call', async () => {
  const workspace = await open();
  const { sets, cardStore, publications } = workspace;
  const set = await sets.create(student('set'), { name: 'A-集', ladder: [1, 3, 7] });
  const learnt = await makeCard(workspace, 'learnt', [], { lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 4 });
  const fresh = await makeCard(workspace, 'fresh');
  const added = await sets.update(student('member', 1), set.ref, { members_add: [learnt.ref, fresh.ref] });
  // Same effective ladder, so membership alone moved no clock.
  expect(cardStore.read(HOST, learnt.ref).data.review).toEqual({ lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 4 });

  const updated = await sets.update(student('ladder', added.version), set.ref, { ladder: [1, 5, 9, 20] });
  expect(updated.ladder).toEqual([1, 5, 9, 20]);
  const saved = cardStore.read(HOST, learnt.ref);
  // Interval 7 falls to step 5 → 2026-09-06; nothing else about the review moved.
  expect(saved.data.review).toEqual({ lastAccessed: '2026-09-01', nextDue: '2026-09-06', reviewCount: 4 });
  expect(saved.data.history).toEqual([]);
  expect(saved.version).toBe(2);
  // An unlearned card is not activated by a policy change.
  expect(cardStore.read(HOST, fresh.ref).data).not.toHaveProperty('review');
  // Both rows went out in the same single publication.
  expect(publications.at(-1)).toEqual(['set', 'card']);
});

test('moving an original between sets refits through the new effective ladder', async () => {
  const workspace = await open();
  const { sets, cardStore, known, publications } = workspace;
  known.add(MAT_A);
  // The original is grouped by the long-ladder set, so the card really reviews there.
  const long = await sets.create(student('long'), { name: 'A-长梯', ladder: [1, 10, 30], materials: [MAT_A] });
  const short = await sets.create(student('short'), { name: 'B-短梯', ladder: [1, 5, 7] });
  const card = await makeCard(workspace, 'learnt', [anchor(MAT_A)], { lastAccessed: '2026-09-01', nextDue: '2026-09-11', reviewCount: 4 });
  expect((await sets.ownership(HOST, card.ref)).map(view => view.ref)).toEqual([long.ref]);
  expect(await sets.effectiveLadder(HOST, card.ref)).toEqual([1, 10, 30]);
  expect(cardStore.read(HOST, card.ref).data.review?.nextDue).toBe('2026-09-11');

  // Grouping the same original under the shorter set wins the effective ladder
  // and refits the due date in the same atomic publication.
  const grouped = await sets.update(student('group', short.version), short.ref, { materials_add: [MAT_A] });
  expect(grouped.materials).toEqual([MAT_A]);
  expect(await sets.effectiveLadder(HOST, card.ref)).toEqual([1, 5, 7]);
  const saved = cardStore.read(HOST, card.ref);
  // Interval 10 falls to step 7 → 2026-09-08; history and count are untouched.
  expect(saved.data.review).toEqual({ lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 4 });
  expect(saved.data.history).toEqual([]);
  expect(saved.version).toBe(2);
  expect(publications.at(-1)).toEqual(['set', 'card']);

  // Ungrouping it from the long set keeps the short ladder: no further move.
  const trimmed = await sets.update(student('ungroup', sets.read(HOST, long.ref).version), long.ref, { materials_remove: [MAT_A] });
  expect(trimmed.materials).toEqual([]);
  expect((await sets.ownership(HOST, card.ref)).map(view => view.ref)).toEqual([short.ref]);
  expect(cardStore.read(HOST, card.ref).data.review?.nextDue).toBe('2026-09-08');
  // A name that only a lost original would have re-homed is refused outright.
  await expect(sets.update(student('ghost-add', trimmed.version), long.ref, { materials_add: [UNKNOWN] }))
    .rejects.toMatchObject({ code: 'set_material_unresolved', problems: [UNKNOWN] });
});

test('a cross-workspace caller is refused, and a refit without a publisher fails closed', async () => {
  const workspace = await open();
  const { sets } = workspace;
  const set = await sets.create(student('set'), { name: 'A-集', ladder: [1, 3, 7] });
  expect(() => sets.read({ ...HOST, workspaceId: 'student-b' }, set.ref)).toThrow(/workspace/);

  // Changing a ladder that would refit a learnt card cannot be half-published:
  // without the atomic publisher the edit is refused and the set keeps its policy.
  const bare = await open(undefined, false);
  const bareSet = await bare.sets.create(student('set'), { name: 'A-集', ladder: [1, 3, 7] });
  const learnt = await makeCard(bare, 'learnt', [], { lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 2 });
  const added = await bare.sets.update(student('member', 1), bareSet.ref, { members_add: [learnt.ref] });
  await expect(bare.sets.update(student('ladder', added.version), bareSet.ref, { ladder: [1, 5, 9, 20] }))
    .rejects.toMatchObject({ code: 'set_refit_unavailable' });
  expect(bare.sets.read(HOST, bareSet.ref).ladder).toEqual([1, 3, 7]);
  expect(bare.cardStore.read(HOST, learnt.ref).data.review?.nextDue).toBe('2026-09-08');

  // A creation that would refit an already-learnt card is refused the same way.
  bare.known.add(MAT_A);
  const card = await makeCard(bare, 'sourced', [anchor(MAT_A)], { lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 2 });
  await expect(bare.sets.create(student('born-short'), { name: 'B-短梯', ladder: [1, 5, 9, 20], materials: [MAT_A] }))
    .rejects.toMatchObject({ code: 'set_refit_unavailable' });
  expect(card.version).toBe(1);
});

test('replaying an old set operation returns its own result and never refits again', async () => {
  const workspace = await open();
  const { sets, cardStore, publications } = workspace;
  const set = await sets.create(student('set'), { name: 'A-集', ladder: [1, 3, 7] });
  const card = await makeCard(workspace, 'learnt', [], { lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 4 });
  const added = await sets.update(student('member', 1), set.ref, { members_add: [card.ref] });
  const first = await sets.update(student('l1', added.version), set.ref, { ladder: [1, 5, 9, 20] });
  expect(first.ladder).toEqual([1, 5, 9, 20]);
  expect(cardStore.read(HOST, card.ref).data.review?.nextDue).toBe('2026-09-06');

  // A later, unrelated edit moves the set's policy on.
  const second = await sets.update(student('l2', first.version), set.ref, { ladder: [1, 3, 7] });
  expect(second.ladder).toEqual([1, 3, 7]);
  // The refit works from the interval the card really had (5 days → step 3).
  expect(cardStore.read(HOST, card.ref).data.review?.nextDue).toBe('2026-09-04');
  const cardVersion = cardStore.read(HOST, card.ref).version;
  const published = publications.length;

  // Replaying the first operation answers with the revision that operation
  // really wrote, and it neither refits against the new policy nor writes again.
  const replay = await sets.update(student('l1', added.version), set.ref, { ladder: [1, 5, 9, 20] });
  expect(replay.version).toBe(first.version);
  expect(replay.ladder).toEqual([1, 5, 9, 20]);
  expect(sets.read(HOST, set.ref).ladder).toEqual([1, 3, 7]);
  expect(cardStore.read(HOST, card.ref).data.review?.nextDue).toBe('2026-09-04');
  expect(cardStore.read(HOST, card.ref).version).toBe(cardVersion);
  expect(publications.length).toBe(published);
});

test('a policy change refits only the cards whose effective ladder really moved', async () => {
  const workspace = await open();
  const { sets, cardStore, known } = workspace;
  known.add(MAT_A);
  known.add(MAT_B);
  // Two sets own this card through the same original; the shorter one is in force.
  const short = await sets.create(student('short'), { name: 'A-短', ladder: [1, 3, 7], materials: [MAT_A] });
  const long = await sets.create(student('long'), { name: 'B-长', ladder: [1, 10, 30], materials: [MAT_A] });
  const card = await makeCard(workspace, 'learnt', [anchor(MAT_A)], { lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 4 });
  expect(sets.effectiveLadder(HOST, card.ref)).toEqual([1, 3, 7]);
  // A card no set owns, with a due date that does not match its own default
  // ladder: a refit is never a background repair of unrelated cards.
  const odd = await makeCard(workspace, 'odd', [], { lastAccessed: '2026-09-01', nextDue: '2026-12-25', reviewCount: 1 });

  // Clearing the short policy falls back to the long ladder, so its due moves.
  const cleared = await sets.update(student('clear', short.version), short.ref, { ladder: null });
  expect(cleared.ladder).toBeNull();
  expect(sets.effectiveLadder(HOST, card.ref)).toEqual([1, 10, 30]);
  // Interval 7 has not reached step 10, so the refit lands on step 1.
  expect(cardStore.read(HOST, card.ref).data.review?.nextDue).toBe('2026-09-02');
  expect(cardStore.read(HOST, odd.ref).data.review?.nextDue).toBe('2026-12-25');
  expect(cardStore.read(HOST, odd.ref).version).toBe(1);

  // Dropping the last group for an original falls back to the default ladder.
  const setB = await sets.create(student('set-b'), { name: 'C-集', ladder: [1, 5, 7], materials: [MAT_B] });
  const sourced = await makeCard(workspace, 'sourced', [anchor(MAT_B)], { lastAccessed: '2026-09-01', nextDue: '2026-09-21', reviewCount: 2 });
  expect(sets.effectiveLadder(HOST, sourced.ref)).toEqual([1, 5, 7]);
  const dropped = await sets.update(student('drop', setB.version), setB.ref, { materials_remove: [MAT_B] });
  expect(dropped.materials).toEqual([]);
  expect(sets.effectiveLadder(HOST, sourced.ref)).toEqual([...DEFAULT_LADDER]);
  // Interval 20 → step 14 on the default ladder, once its set no longer owns it.
  expect(cardStore.read(HOST, sourced.ref).data.review?.nextDue).toBe('2026-09-15');
  // The unrelated card was still never touched.
  expect(cardStore.read(HOST, odd.ref).data.review?.nextDue).toBe('2026-12-25');
  expect(cardStore.read(HOST, odd.ref).version).toBe(1);
  expect(sets.effectiveLadder(HOST, odd.ref)).toEqual([...DEFAULT_LADDER]);
});

test('a set may be born with real members, refitted in the same publication', async () => {
  const workspace = await open();
  const { sets, cardStore, publications } = workspace;
  // A learnt card with no set reviews on the default ladder.
  const learnt = await makeCard(workspace, 'learnt', [], { lastAccessed: '2026-09-01', nextDue: '2026-09-08', reviewCount: 3 });
  expect(sets.effectiveLadder(HOST, learnt.ref)).toEqual([...DEFAULT_LADDER]);

  // A member that is not a real card never becomes membership, and nothing is stored.
  await expect(sets.create(student('bad-set'), { name: 'A-坏集', members: ['card:ghost'] }))
    .rejects.toMatchObject({ code: 'set_member_unresolved', problems: ['card:ghost'] });
  expect(sets.list(HOST)).toEqual([]);

  // Creating the set with the card really moves it onto this policy, and the due
  // date is refitted by the same single atomic publication.
  const born = await sets.create(student('born'), { name: 'A-期末复习', ladder: [1, 5, 9, 20], members: [learnt.ref] });
  expect(born.members).toEqual([learnt.ref]);
  expect(sets.effectiveLadder(HOST, learnt.ref)).toEqual([1, 5, 9, 20]);
  expect((await sets.ownership(HOST, learnt.ref)).map(view => view.ref)).toEqual([born.ref]);
  // Interval 7 falls to step 5 → 2026-09-06; history and count are untouched.
  const saved = cardStore.read(HOST, learnt.ref);
  expect(saved.data.review).toEqual({ lastAccessed: '2026-09-01', nextDue: '2026-09-06', reviewCount: 3 });
  expect(saved.data.history).toEqual([]);
  expect(saved.version).toBe(2);
  expect(publications.at(-1)).toEqual(['set', 'card']);

  // Replaying the creation answers the version it wrote and refits nothing again.
  const published = publications.length;
  expect(await sets.create(student('born'), { name: 'A-期末复习', ladder: [1, 5, 9, 20], members: [learnt.ref] })).toEqual(born);
  expect(publications.length).toBe(published);
  expect(cardStore.read(HOST, learnt.ref).data.review?.nextDue).toBe('2026-09-06');
  // A set with no members is still legal and starts empty.
  expect((await sets.create(student('empty'), { name: 'B-空集' })).members).toEqual([]);
});
