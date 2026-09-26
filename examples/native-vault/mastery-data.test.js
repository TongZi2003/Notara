import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVaultStore, parseMarkdownDocument, revisionFor } from './vault.js';
import { NotaraVaultRemote } from './index.js';
import { serializeFrontmatter } from './frontmatter.js';
import { recordReviewContent, reviewState, undoReviewContent } from './review-data.js';
import { buildVaultGraph, collapseVaultGraph, filterVaultGraph } from './graph.js';
import { BKT_DEFAULTS, MASTERY_EPSILON, aggregateLeaves, evidenceOf, leafMastery, learningStars } from './mastery-data.js';

const doc = (path, content) => parseMarkdownDocument(path, content, revisionFor(content));
const page = (path, fields, body = '') => doc(path, serializeFrontmatter(fields) + `# ${path.split('/').pop().replace(/\.md$/, '')}\n\n${body}`);
const observed = (outcome, ability = '判断焦点位置') => ({ ability, outcome });
let sequence = 0;
const evaluate = (document, day, assessments) => doc(document.path, recordReviewContent(document, {
  id: `review-${++sequence}`, at: `${day}T04:00:00.000Z`, day, assessments, note: '学生自己说出了判断依据。', actor: 'teacher', sessionId: 'synthetic-lesson',
}));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('BKT updates only on demonstrated or needs_practice evidence', () => {
  const hit = leafMastery([{ at: '2026-09-20T04:00:00.000Z', assessments: [observed('demonstrated')] }]);
  close(hit.probability, 0.6);
  assert.equal(hit.evidenceCount, 1);
  assert.equal(hit.observed, true);
  assert.equal(hit.lastEvidenceAt, '2026-09-20T04:00:00.000Z');
  assert.equal(hit.confidence, 'emerging');

  const miss = leafMastery([{ at: 'x', assessments: [observed('needs_practice')] }]);
  close(miss.probability, 0.02 / 0.66 + (1 - 0.02 / 0.66) * BKT_DEFAULTS.learn);
  assert.ok(miss.probability < BKT_DEFAULTS.prior, 'a real difficulty lowers the estimate');

  // A mixed record is one opportunity with a real difficulty in it.
  assert.equal(evidenceOf({ assessments: [observed('demonstrated'), observed('needs_practice', '迁移')] }), 'miss');
  assert.equal(evidenceOf({ assessments: [observed('demonstrated'), observed('not_observed', '迁移')] }), 'hit');

  const supported = leafMastery([1, 2, 3].map(day => ({ at: `2026-09-0${day}`, assessments: [observed('demonstrated')] })));
  assert.equal(supported.confidence, 'supported');
  assert.ok(supported.probability > 0.95);
});

test('no evidence is neither failure nor mastery: not_observed, reverted and legacy rows keep the prior', () => {
  const unobserved = leafMastery([
    { at: 'a', assessments: [observed('not_observed')] },
    { at: 'b', assessments: [observed('demonstrated')], revertedAt: 'c' },
    { at: 'd', passed: true },
  ]);
  assert.deepEqual(unobserved, { probability: BKT_DEFAULTS.prior, evidenceCount: 0, observed: false, confidence: 'prior' });
  assert.deepEqual(leafMastery([]), unobserved);
});

test('weighted geometric mean keeps weak leaves visible and epsilon bounds zero', () => {
  close(aggregateLeaves([{ probability: 0.9, observed: true }, { probability: 0.1, observed: false }]).mastery, 0.3);
  assert.equal(aggregateLeaves([{ probability: 0.9, observed: true }, { probability: 0.1, observed: false }]).coverage, 0.5);
  const weighted = aggregateLeaves([{ probability: 0.9, observed: true, weight: 3 }, { probability: 0.1, observed: false, weight: 1 }]);
  close(weighted.mastery, Math.exp((3 * Math.log(0.9) + Math.log(0.1)) / 4));
  assert.equal(weighted.coverage, 0.75);
  close(aggregateLeaves([{ probability: 0, observed: true }]).mastery, MASTERY_EPSILON);
  assert.equal(aggregateLeaves([]), null);
  // A few bright leaves cannot light a branch that is mostly unobserved.
  const branch = aggregateLeaves([{ probability: 0.97, observed: true }, ...Array.from({ length: 5 }, () => ({ probability: BKT_DEFAULTS.prior, observed: false }))]);
  assert.ok(branch.mastery < 0.3 && branch.coverage < 0.2);
});

test('parents aggregate every leaf descendant, whatever the filter or expansion shows', () => {
  let focus = page('卡片/焦点.md', { type: 'card', parent: '卡片/圆锥曲线.md', tags: ['几何'] });
  focus = evaluate(evaluate(focus, '2026-09-20', [observed('demonstrated')]), '2026-09-21', [observed('demonstrated')]);
  let eccentricity = page('卡片/离心率.md', { type: 'card', parent: '卡片/椭圆.md' });
  eccentricity = evaluate(eccentricity, '2026-09-22', [observed('needs_practice', '由离心率反推参数')]);
  const documents = [
    page('卡片/圆锥曲线.md', { type: 'card', tags: ['总览'] }),
    page('卡片/椭圆.md', { type: 'card', parent: '卡片/圆锥曲线.md' }),
    focus,
    eccentricity,
    page('卡片/参数.md', { type: 'card', parent: '卡片/椭圆.md' }),
    page('锦囊/画图.md', { type: 'insight', parent: '卡片/圆锥曲线.md' }),
    doc('卡片/坏记录.md', '---\ntype: card\nparent: 卡片/椭圆.md\nreview_history: 3\n---\n# 坏记录\n'),
  ];
  const before = JSON.stringify(documents);
  const graph = buildVaultGraph(documents, []);
  const stars = learningStars(graph, documents).nodes;

  assert.equal(stars['卡片/焦点.md'].kind, 'leaf');
  assert.equal(stars['卡片/焦点.md'].evidenceCount, 2);
  assert.equal(stars['卡片/参数.md'].observed, false);
  assert.equal(stars['卡片/坏记录.md'].unreadable, true);
  assert.equal(stars['锦囊/画图.md'].kind, 'unlinked');

  const ellipse = stars['卡片/椭圆.md'], root = stars['卡片/圆锥曲线.md'];
  assert.equal(ellipse.kind, 'parent');
  assert.equal(ellipse.leafCount, 2);
  assert.equal(ellipse.unreadableCount, 1);
  close(ellipse.mastery, Math.sqrt(stars['卡片/离心率.md'].probability * BKT_DEFAULTS.prior));
  assert.equal(root.leafCount, 3, 'grandchildren through an intermediate card count');
  assert.equal(root.observedCount, 2);
  close(root.coverage, 2 / 3);
  close(root.mastery, Math.cbrt(stars['卡片/焦点.md'].probability * stars['卡片/离心率.md'].probability * BKT_DEFAULTS.prior));
  assert.equal(root.lastEvidenceAt, '2026-09-22T04:00:00.000Z');

  // The same Host projection serves every drawn slice: nothing is recomputed from
  // what a tag filter or a collapsed layer happens to show.
  assert.equal(filterVaultGraph(graph, { tags: ['总览'] }).nodes.length, 1);
  assert.equal(collapseVaultGraph(graph, []).nodes.length, 1);
  assert.deepEqual(learningStars(graph, documents).nodes, stars);
  // The projection reads; it never writes review fields back.
  assert.equal(JSON.stringify(documents), before);
});

test('undoing the only evaluation returns the leaf to the prior', () => {
  const card = page('卡片/单卡.md', { type: 'card' });
  const evaluated = evaluate(card, '2026-09-20', [observed('demonstrated')]);
  const undone = doc(card.path, undoReviewContent(evaluated, { at: '2026-09-20T05:00:00.000Z' }));
  const graph = buildVaultGraph([undone], []);
  assert.deepEqual(reviewState(undone), reviewState(card));
  assert.equal(learningStars(graph, [undone]).nodes[card.path].observed, false);
});

test('store.learningStars() re-reads the cards, follows new evidence and writes nothing back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-stars-'));
  try {
    await mkdir(join(root, '卡片'));
    const parent = serializeFrontmatter({ type: 'card' }) + '# 函数\n';
    const empty = page('卡片/单调性.md', { type: 'card', parent: '卡片/函数.md' });
    await writeFile(join(root, '卡片/函数.md'), parent);
    await writeFile(join(root, '卡片/单调性.md'), empty.content);
    const store = createVaultStore(root);

    const first = (await store.learningStars()).nodes;
    assert.equal(first['卡片/单调性.md'].observed, false);
    assert.equal(first['卡片/函数.md'].coverage, 0);

    const evaluated = evaluate(empty, '2026-09-24', [observed('demonstrated', '由导数符号判断单调区间')]);
    await writeFile(join(root, '卡片/单调性.md'), evaluated.content);
    const second = (await store.learningStars()).nodes;
    close(second['卡片/单调性.md'].probability, 0.6);
    assert.equal(second['卡片/函数.md'].coverage, 1);
    assert.equal(await readFile(join(root, '卡片/单调性.md'), 'utf8'), evaluated.content);
    assert.equal(await readFile(join(root, '卡片/函数.md'), 'utf8'), parent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the remote exposes learningStars with only a session scope', async () => {
  const methods = NotaraVaultRemote.prototype['@deepseek-ai/dsh-typert-protocol/remote-methods'].methods;
  assert.ok(methods.some(entry => entry.method === 'learningStars' && entry.invocation.kind === 'direct'));
  const remote = Object.create(NotaraVaultRemote.prototype);
  remote.storeFor = async () => ({ learningStars: async () => ({ nodes: {} }) });
  assert.deepEqual(await remote.learningStars({ sessionId: 'lesson' }), { nodes: {} });
  await assert.rejects(() => remote.learningStars({ sessionId: 'lesson', path: '卡片/甲.md' }), /vault_input_invalid/);
});
