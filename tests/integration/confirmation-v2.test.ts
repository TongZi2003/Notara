/**
 * P5.3 冻结目标、编辑版与持久确认（plan §P5.3）。
 *
 * 提案、attempt、receipt 都活在真实的 `RecordStore` 里，效果由注入的 executor 写到真实的
 * CardService 上。被固定的性质：原稿与目标一旦提出就不再被改稿挪走；确认说的是"我看到
 * 的那一版、那个目标、那个基线"，对不上就是旧稿冲突；每项各自 pending/applied/rejected/
 * failed，成功项不会再写第二遍，取消剩余项不撤销已应用的事实；执行之前先落 attempt，
 * 于是"目标写成、回执没落"的重试沿用同一个 operation，只把已经落下的那次写回来。
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import { ProposalEditInputSchema, ProposalEffectSchema, ProposalInputSchema, ProposalRecordSchema, type ProposalView } from '../../packages/contracts/src/proposals.ts';
import { SkeletonRecordSchema } from '../../packages/contracts/src/skeleton.ts';
import { createClock } from '../../packages/domain/src/clock.ts';
import { CardService } from '../../packages/domain/src/cards/card-service.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { SKELETON_KIND, SkeletonService } from '../../packages/domain/src/materials/skeleton-service.ts';
import { ProposalEffectRejected, ProposalService, proposalEffectDigest, stableEffectOperationId, type ProposalExecutor, type ProposalRecordStore } from '../../packages/domain/src/proposals/proposal-service.ts';
import { ReceiptOutbox } from '../../packages/domain/src/proposals/receipt-outbox.ts';
import { RecordError } from '../../packages/domain/src/storage/record-store.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const student = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ ...HOST, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const teacher = (operationId: string): MutationContext => ({ ...HOST, actor: 'teacher', operationId });

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** 模型/Host 交进来的原始效果：默认值由同源 schema 在边界补，测试不手抄。 */
const newCard = (title: string) => ({ kind: 'card-create' as const, content: { title, front: title } });
const NATIVE = { kind: 'native' as const, sessionId: 'lesson-a', callId: 'call-1' };
const proposal = (...effects: ReturnType<typeof newCard>[]) =>
  ({ title: '本课待确认', origin: NATIVE, items: effects.map(effect => ({ effect })) });

/** 学生在界面上看到的那一版：记录版本 + 每项的 draft/digest/target/baseline。 */
function selection(view: ProposalView, itemIds: string[] = view.items.map(item => item.id)) {
  return {
    revision: view.version,
    items: view.items.filter(item => itemIds.includes(item.id))
      .map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })),
  };
}

async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-confirm-'));
  if (!roots.includes(dir)) roots.push(dir);
  // 一个会走的时钟：重试同一次提案时它已经不同，冻结的时间不该跟着变。
  const state = { now: '2026-09-12T00:00:00Z' };
  const clock = createClock('Asia/Shanghai', () => state.now);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const cardStore = await owner.collection('card', CardRecordSchema);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  const skeletons = new SkeletonService(await owner.collection(SKELETON_KIND, SkeletonRecordSchema), materials);
  const cards = new CardService(cardStore, materials, skeletons);
  const raw = await owner.collection('proposal', ProposalRecordSchema);

  // 一个真实故障：目标已经写成，回执那一步的写盘失败。
  const faults = { failNextOutcome: false, severAfterWrite: false, rejectNext: 0 };
  const records: ProposalRecordStore = {
    get workspaceId() { return raw.workspaceId; },
    read: (host, ref, revision) => raw.read(host, ref, revision),
    list: host => raw.list(host),
    create: (write, id, input) => raw.create(write, id, input),
    update: (write, ref, input, transform) => raw.update(write, ref, input, transform),
    updateCurrent: (write, ref, input, transform) => faults.failNextOutcome
      ? Promise.reject(new RecordError('storage_unavailable'))
      : raw.updateCurrent(write, ref, input, transform),
  };

  // 注入的执行者：真的走 CardService，operation 与基线由提案层给出。
  const calls: string[] = [];
  const executor: ProposalExecutor = {
    validate: async (host, item) => { if (item.effect.kind === 'card-create') await cards.check(host, item.effect.content); },
    apply: async (write, item) => {
      calls.push(write.operationId);
      // 执行者只有明确知道"确定没写"时才抛这个；其余异常都算 commit 未知。
      if (faults.rejectNext > 0) { faults.rejectNext -= 1; throw new ProposalEffectRejected('card_refused_before_write'); }
      if (item.effect.kind === 'card-create') {
        const card = await cards.create(write, item.effect.content);
        // 目标已经保存，只是回复没回来。
        if (faults.severAfterWrite) { faults.severAfterWrite = false; throw new Error('link severed after the write'); }
        return { target: card.ref, revision: card.version, title: card.content.title };
      }
      if (item.effect.kind === 'card-edit' && item.target !== null) {
        try {
          const card = await cards.edit(write, item.target, item.effect.patch);
          return { target: card.ref, revision: card.version, title: card.content.title };
        } catch (error) {
          // 目标写者的条件检查直接拒绝（基线已经变了）= 确定没写；Host 适配层这样翻译。
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'version_conflict') {
            throw new ProposalEffectRejected('card_version_conflict');
          }
          throw error;
        }
      }
      throw new Error('unwired effect');
    },
  };

  const proposals = new ProposalService(records, clock, executor);
  const outbox = new ReceiptOutbox(records, clock);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { dir, owner, cardStore, cards, records, proposals, outbox, calls, faults, state };
}

test('原稿与目标冻结：学生改稿后旧确认冲突，改用新稿才落地', async () => {
  const { proposals, cardStore, owner, dir } = await open();
  const created = await proposals.propose(teacher('propose-1'), proposal(newCard('第一张')));
  const item = created.items[0]!;
  expect(item).toMatchObject({ id: 'item-1', status: 'pending', target: null, baseline: null });
  expect(item.original).toEqual(item.draft);
  // digest 认的是 canonical（已套用字段默认值的）内容，不是测试里那串字面量。
  expect(item.draft.digest).toBe(proposalEffectDigest(ProposalEffectSchema.parse(newCard('第一张'))));

  // 机械字段不由模型填：伪造 id/digest/status 在输入边界就被拒。
  expect(() => ProposalInputSchema.parse({ ...proposal(newCard('x')), items: [{ effect: newCard('x'), id: 'item-9' }] })).toThrow();
  expect(() => ProposalInputSchema.parse({ ...proposal(newCard('x')), items: [{ effect: newCard('x'), digest: 'sha256:0', status: 'applied' }] })).toThrow();

  const seenOld = selection(created);
  const edited = await proposals.edit(student('edit-1', created.version), created.ref,
    { itemId: 'item-1', effect: newCard('第一张（改过）') });
  expect(edited.items[0]!.drafts).toHaveLength(2);
  expect(edited.items[0]!.original.digest).toBe(item.draft.digest);
  expect(edited.items[0]!.draft.revision).toBe(2);

  // 旧稿的那一次确认说的还是第 1 版，必须冲突而不是把新稿写成效果。
  await expect(proposals.confirm(student('confirm-old'), created.ref, seenOld)).rejects.toMatchObject({ code: 'proposal_stale_confirmation' });
  expect(cardStore.list(HOST)).toHaveLength(0);

  const applied = await proposals.confirm(student('confirm-1'), edited.ref, selection(edited));
  expect(applied.items[0]!.status).toBe('applied');
  expect(applied.items[0]!.receipt).toMatchObject({
    // 确认的是学生改出来的第 2 版，所以效果用的是它自己的 operation。
    confirmationId: 'confirm-1', operationId: stableEffectOperationId(created.ref, 'item-1', 2), revision: 1, title: '第一张（改过）',
  });
  expect(cardStore.list(HOST)).toHaveLength(1);
  await expect(proposals.edit(student('edit-after', applied.version), applied.ref, { itemId: 'item-1', effect: newCard('再改') }))
    .rejects.toMatchObject({ code: 'proposal_item_closed' });

  // 提案与回执跨重启还在。
  await owner.close();
  const reopened = await open(dir);
  expect(reopened.proposals.read(HOST, created.ref).items[0]).toMatchObject({ status: 'applied' });
  expect(reopened.proposals.list(HOST).map(view => view.ref)).toEqual([created.ref]);
});

test('原生提案绑定它来自哪次工具调用，时钟走过之后重试仍是同一条', async () => {
  const { proposals, state } = await open();
  const view = await proposals.propose(teacher('propose-native'), {
    title: '来自课堂', origin: { kind: 'native', sessionId: 'lesson-a', callId: 'call-7' }, items: [{ effect: newCard('原生卡') }],
  });
  expect(view.origin).toEqual({ kind: 'native', sessionId: 'lesson-a', callId: 'call-7' });
  expect(view.items[0]!.draft.at).toBe('2026-09-12T00:00:00Z');

  // 时钟往前走了，重试同一次提案必须还是同一条记录、同一份冻结时间。
  state.now = '2026-09-13T09:00:00Z';
  expect(await proposals.propose(teacher('propose-native'), {
    title: '来自课堂', origin: { kind: 'native', sessionId: 'lesson-a', callId: 'call-7' }, items: [{ effect: newCard('原生卡') }],
  })).toEqual(view);
  expect(proposals.list(HOST)).toHaveLength(1);

  // 同一个 operation 不能换一次调用身份重来。
  await expect(proposals.propose(teacher('propose-native'), {
    title: '来自课堂', origin: { kind: 'native', sessionId: 'lesson-a', callId: 'call-8' }, items: [{ effect: newCard('原生卡') }],
  })).rejects.toMatchObject({ code: 'record_exists' });
});

test('丢 ACK 的改稿重试沿用原 operation 与输入基线，不追加第二版', async () => {
  const { proposals } = await open();
  const created = await proposals.propose(teacher('propose-ack'), proposal(newCard('原始')));
  const edited = await proposals.edit(student('edit-ack', created.version), created.ref,
    { itemId: 'item-1', effect: newCard('改过') });
  expect(edited.items[0]!.drafts).toHaveLength(2);

  // 回复没有回来，调用方拿同样的 operation 与同样的基线重试。
  expect(await proposals.edit(student('edit-ack', created.version), created.ref,
    { itemId: 'item-1', effect: newCard('改过') })).toEqual(edited);
  expect(proposals.read(HOST, created.ref).items[0]!.drafts).toHaveLength(2);

  // 换一个 operation 用旧基线才是真的过期。
  await expect(proposals.edit(student('edit-stale', created.version), created.ref,
    { itemId: 'item-1', effect: newCard('又一版') })).rejects.toMatchObject({ code: 'version_conflict' });
});

test('确认绑定所见的目标与基线，改稿不会把它们挪走', async () => {
  const { proposals, cards } = await open();
  const card = await cards.create(student('seed-card'), { title: '判别式', front: 'Δ=b²-4ac' });
  const view = await proposals.propose(teacher('propose-edit'), {
    title: '改这一张', origin: { kind: 'snapshot' },
    items: [{ effect: { kind: 'card-edit', patch: { tags: ['代数'] } }, target: card.ref, baseline: card.version }],
  });
  const seen = selection(view);
  const tamper = (patch: Partial<typeof seen.items[number]>) => ({ ...seen, items: [{ ...seen.items[0]!, ...patch }] });
  await expect(proposals.confirm(student('confirm-other-target'), view.ref, tamper({ target: 'card:other' })))
    .rejects.toMatchObject({ code: 'proposal_stale_confirmation' });
  await expect(proposals.confirm(student('confirm-other-baseline'), view.ref, tamper({ baseline: 9 })))
    .rejects.toMatchObject({ code: 'proposal_stale_confirmation' });
  await expect(proposals.confirm(student('confirm-other-digest'), view.ref, tamper({ digest: 'sha256:0000' })))
    .rejects.toMatchObject({ code: 'proposal_stale_confirmation' });

  const edited = await proposals.edit(student('edit-tags', view.version), view.ref,
    { itemId: 'item-1', effect: { kind: 'card-edit', patch: { tags: ['代数', '函数'] } } });
  expect(edited.items[0]).toMatchObject({ target: card.ref, baseline: card.version });
  expect(edited.items[0]!.draft.revision).toBe(2);

  const applied = await proposals.confirm(student('confirm-edit'), view.ref, selection(edited));
  expect(applied.items[0]!.receipt).toMatchObject({ target: card.ref, revision: 2 });
  expect(cards.read(HOST, card.ref).content.tags).toEqual(['代数', '函数']);
});

test('多项各自成事：成功项不重复，取消剩余项不撤销已应用的事实', async () => {
  const { proposals, cardStore, calls } = await open();
  const view = await proposals.propose(teacher('propose-many'), proposal(newCard('A'), newCard('B'), newCard('C')));
  const first = await proposals.confirm(student('confirm-ab'), view.ref, selection(view, ['item-1', 'item-2']));
  expect(first.items.map(item => item.status)).toEqual(['applied', 'applied', 'pending']);
  expect(calls).toHaveLength(2);

  const again = await proposals.confirm(student('confirm-ab-again'), view.ref, selection(first, ['item-1', 'item-2']));
  expect(again.items[0]!.receipt).toEqual(first.items[0]!.receipt);
  expect(calls).toHaveLength(2);
  expect(cardStore.list(HOST)).toHaveLength(2);

  const rejected = await proposals.reject(student('reject-c'), again.ref, selection(again, ['item-3']));
  expect(rejected.items.map(item => item.status)).toEqual(['applied', 'applied', 'rejected']);
  expect(cardStore.list(HOST)).toHaveLength(2);
  await expect(proposals.confirm(student('confirm-c-late'), rejected.ref, selection(rejected, ['item-3'])))
    .rejects.toMatchObject({ code: 'proposal_item_closed' });
});

test('目标写成而回执未落的故障：未知 commit 不许改稿，重启后同一 operation 重试只写一遍', async () => {
  const { proposals, cardStore, calls, faults, owner, dir } = await open();
  const view = await proposals.propose(teacher('propose-sever'), proposal(newCard('断线题')));
  faults.failNextOutcome = true;
  await expect(proposals.confirm(student('confirm-sever'), view.ref, selection(view))).rejects.toMatchObject({ code: 'storage_unavailable' });

  const frozen = proposals.read(HOST, view.ref);
  expect(frozen.items[0]).toMatchObject({ status: 'pending', attempt: { operationId: stableEffectOperationId(view.ref, 'item-1', 1), draft: 1 } });
  expect(frozen.items[0]!.receipt).toBeUndefined();
  expect(cardStore.list(HOST)).toHaveLength(1);
  const landed = cardStore.list(HOST)[0]!;

  // 效果可能已经落盘：这一版既不能改、也不能当作取消。
  await expect(proposals.edit(student('edit-unknown', frozen.version), view.ref, { itemId: 'item-1', effect: newCard('改一版') }))
    .rejects.toMatchObject({ code: 'proposal_commit_unknown' });
  await expect(proposals.reject(student('reject-unknown'), view.ref, selection(frozen)))
    .rejects.toMatchObject({ code: 'proposal_commit_unknown' });

  await owner.close();
  const reopened = await open(dir);
  expect(reopened.proposals.read(HOST, view.ref).items[0]).toMatchObject({ status: 'pending', attempt: { operationId: stableEffectOperationId(view.ref, 'item-1', 1) } });
  const retried = await reopened.proposals.confirm(student('confirm-retry'), view.ref, selection(reopened.proposals.read(HOST, view.ref)));
  expect(retried.items[0]!.status).toBe('applied');
  expect(retried.items[0]!.receipt).toMatchObject({ target: landed.ref, revision: landed.version, title: '断线题' });
  expect(reopened.cardStore.list(HOST)).toHaveLength(1);
  expect(reopened.calls).toEqual([stableEffectOperationId(view.ref, 'item-1', 1)]);
  expect(calls.filter(operationId => operationId === stableEffectOperationId(view.ref, 'item-1', 1))).toHaveLength(1);
});

test('执行者在真实写卡之后才抛错：这一版稿被锁住，同 op 重试恢复同一张卡与同一份原稿', async () => {
  const { proposals, cardStore, cards, calls, faults, owner, dir } = await open();
  const view = await proposals.propose(teacher('propose-exec-sever'), proposal(newCard('断线原稿')));
  const effect = view.items[0]!.draft.effect;
  const content = effect.kind === 'card-create' ? effect.content : undefined;

  faults.severAfterWrite = true;
  const failed = await proposals.confirm(student('confirm-exec-sever'), view.ref, selection(view));
  expect(failed.items[0]).toMatchObject({ status: 'failed', failure: { code: 'Error', retryable: true, commit: 'unknown' } });
  expect(failed.items[0]!.receipt).toBeUndefined();
  const landed = cardStore.list(HOST)[0]!;
  expect(cardStore.list(HOST)).toHaveLength(1);

  // commit 未知：既不能换稿，也不能当作取消。
  await expect(proposals.edit(student('edit-exec-unknown', failed.version), view.ref, { itemId: 'item-1', effect: newCard('换一版') }))
    .rejects.toMatchObject({ code: 'proposal_commit_unknown' });
  await expect(proposals.reject(student('reject-exec-unknown'), view.ref, selection(failed)))
    .rejects.toMatchObject({ code: 'proposal_commit_unknown' });
  expect(calls).toHaveLength(1);

  // 重启后拿同一个 operation 重试：还是那一张卡，内容与冻结的原稿逐字相同。
  await owner.close();
  const reopened = await open(dir);
  const retried = await reopened.proposals.confirm(student('confirm-exec-retry'), view.ref,
    selection(reopened.proposals.read(HOST, view.ref)));
  const receipt = retried.items[0]!.receipt!;
  expect(retried.items[0]!.status).toBe('applied');
  expect(receipt).toMatchObject({ target: landed.ref, operationId: stableEffectOperationId(view.ref, 'item-1', 1) });
  expect(reopened.cardStore.list(HOST)).toHaveLength(1);
  expect(reopened.cards.read(HOST, receipt.target).content).toEqual(content);
});

test('执行者确定没写：允许换稿与取消，新稿用新的 operation 重新确认', async () => {
  const { proposals, cardStore, calls, faults } = await open();
  const view = await proposals.propose(teacher('propose-refused'), proposal(newCard('没写成的稿'), newCard('另一张')));
  faults.rejectNext = 2;
  const refused = await proposals.confirm(student('confirm-refused'), view.ref, selection(view));
  expect(refused.items.map(item => item.status)).toEqual(['failed', 'failed']);
  expect(refused.items.map(item => item.failure!.commit)).toEqual(['none', 'none']);
  expect(refused.items[0]!.failure).toMatchObject({ code: 'card_refused_before_write' });
  expect(cardStore.list(HOST)).toHaveLength(0);

  // 确定没写：换稿与取消都放行。
  const edited = await proposals.edit(student('edit-refused', refused.version), view.ref,
    { itemId: 'item-1', effect: newCard('改好的稿') });
  expect(edited.items[0]).toMatchObject({ status: 'pending', target: null, baseline: null, draft: { revision: 2 } });
  expect(edited.items[0]!.attempt).toBeUndefined();
  expect(edited.items[0]!.failure).toBeUndefined();
  const rejected = await proposals.reject(student('reject-refused', edited.version), edited.ref, selection(edited, ['item-2']));
  expect(rejected.items.map(item => item.status)).toEqual(['pending', 'rejected']);

  const applied = await proposals.confirm(student('confirm-refused-2'), rejected.ref, selection(rejected, ['item-1']));
  expect(applied.items[0]!.status).toBe('applied');
  expect(applied.items[0]!.receipt).toMatchObject({ operationId: stableEffectOperationId(view.ref, 'item-1', 2) });
  expect(applied.items[0]!.receipt!.operationId).not.toBe(stableEffectOperationId(view.ref, 'item-1', 1));
  expect(cardStore.list(HOST)).toHaveLength(1);
  expect(cardStore.list(HOST)[0]!.data.content.title).toBe('改好的稿');
  expect(calls).toEqual([
    stableEffectOperationId(view.ref, 'item-1', 1), stableEffectOperationId(view.ref, 'item-2', 1),
    stableEffectOperationId(view.ref, 'item-1', 2),
  ]);
});

test('一个 tab 的确认被另一个挡回，效果只落一次', async () => {
  const { proposals, cardStore, calls } = await open();
  const view = await proposals.propose(teacher('propose-race'), proposal(newCard('并发卡')));
  const seen = selection(view);
  const results = await Promise.allSettled([
    proposals.confirm(student('confirm-a'), view.ref, seen),
    proposals.confirm(student('confirm-b'), view.ref, seen),
  ]);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'version_conflict' });
  expect(calls).toHaveLength(1);
  expect(cardStore.list(HOST)).toHaveLength(1);
  expect(proposals.read(HOST, view.ref).items[0]).toMatchObject({ status: 'applied' });
});

test('目标卡已经被人改过：确定 version_conflict 后显式重绑基线并合并内容', async () => {
  const { proposals, cards } = await open();
  const card = await cards.create(student('seed-stale'), { title: '原件', front: 'x' });
  const view = await proposals.propose(teacher('propose-stale'), {
    title: '加一句', origin: NATIVE,
    items: [{ effect: { kind: 'card-edit', patch: { notes: '老师想加的一句' } }, target: card.ref, baseline: card.version }],
  });
  await cards.edit(student('student-first', card.version), card.ref, { notes: '学生自己先改了' });

  // 目标写者在条件检查上直接拒绝：这一版稿确定没写，但基线一直是旧的。
  const failed = await proposals.confirm(student('confirm-stale'), view.ref, selection(view));
  expect(failed.items[0]).toMatchObject({ status: 'failed', failure: { code: 'card_version_conflict', commit: 'none' } });
  expect(failed.items[0]!.receipt).toBeUndefined();
  expect(failed.items[0]!.attempt).toMatchObject({ operationId: stableEffectOperationId(view.ref, 'item-1', 1) });
  expect(cards.read(HOST, card.ref)).toMatchObject({ version: 2, content: { notes: '学生自己先改了' } });
  // 确定没写的失败项可以重试，但同一版稿会再次被同一个条件拒绝，目标不受影响。
  const retried = await proposals.confirm(student('confirm-stale-again'), failed.ref, selection(failed));
  expect(retried.items[0]).toMatchObject({ status: 'failed', failure: { code: 'card_version_conflict', commit: 'none' } });
  expect(cards.read(HOST, card.ref).version).toBe(2);

  // 重绑必须成对：只贴一个新 target 是坏输入。
  const merged = { kind: 'card-edit', patch: { notes: '学生自己先改了；老师想加的一句' } } as const;
  expect(() => ProposalEditInputSchema.parse({ itemId: 'item-1', effect: merged, target: card.ref })).toThrow();

  // Host 重读目标后显式采用新的一对（revision 2），内容由调用方合并好。
  const rebased = await proposals.edit(student('edit-rebase', retried.version), view.ref,
    { itemId: 'item-1', effect: merged, target: card.ref, baseline: 2 });
  expect(rebased.items[0]).toMatchObject({ target: card.ref, baseline: 2, status: 'pending', draft: { revision: 2 } });
  expect(rebased.items[0]!.failure).toBeUndefined();
  expect(rebased.items[0]!.attempt).toBeUndefined();

  // 旧确认即使被补上新 digest，也因 revision 与 baseline 对不上而冲突。
  const seenOld = selection(view);
  const patched = { ...seenOld, items: [{ ...seenOld.items[0]!, digest: rebased.items[0]!.draft.digest }] };
  await expect(proposals.confirm(student('confirm-patched'), view.ref, patched))
    .rejects.toMatchObject({ code: 'proposal_stale_confirmation' });

  const applied = await proposals.confirm(student('confirm-rebase'), rebased.ref, selection(rebased));
  expect(applied.items[0]!.status).toBe('applied');
  expect(applied.items[0]!.receipt).toMatchObject({
    target: card.ref, revision: 3, operationId: stableEffectOperationId(view.ref, 'item-1', 2),
  });
  expect(cards.read(HOST, card.ref)).toMatchObject({ version: 3, content: { notes: '学生自己先改了；老师想加的一句' } });
});

test('outbox 只投影真实回执，投递标记不是消费 ACK', async () => {
  const { proposals, outbox } = await open();
  const view = await proposals.propose(teacher('propose-outbox'), proposal(newCard('回执卡'), newCard('还没写的卡')));
  expect(outbox.list(HOST)).toEqual([]);

  const applied = await proposals.confirm(student('confirm-outbox'), view.ref, selection(view, ['item-1']));
  expect(applied.items[1]!.status).toBe('pending');
  expect(applied.items[1]!.receipt).toBeUndefined();
  const entries = outbox.list(HOST);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ proposalRef: view.ref, itemId: 'item-1', receipt: { confirmationId: 'confirm-outbox' } });
  expect(outbox.pending(HOST)).toHaveLength(1);

  expect(await outbox.markDelivered(student('deliver-1'), entries)).toBe(1);
  expect(outbox.pending(HOST)).toEqual([]);
  expect(outbox.list(HOST)[0]!.receipt).toMatchObject({ deliveredAt: '2026-09-12T00:00:00Z' });
  expect(await outbox.markDelivered(student('deliver-2'), entries)).toBe(0);

  await expect(outbox.markDelivered(student('deliver-missing'), [{ proposalRef: view.ref, itemId: 'item-2' }]))
    .rejects.toMatchObject({ code: 'proposal_receipt_missing' });
  expect(outbox.pending(HOST)).toEqual([]);
});
