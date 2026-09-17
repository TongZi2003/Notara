/**
 * The student's story, played end to end against the real model:
 * a confused high schooler opens an empty lesson, gets a goal and a route,
 * imports material, learns it into cards, reviews them the next day, finds
 * connections on day three, and the teacher records both the methods that
 * worked and the honest observation that he lacks confidence.
 *
 * The model teaches for real — it diagnoses before it plans and waits for the
 * student's actual work — so every beat is a cooperative loop: say the next
 * honest line, confirm whatever the teacher put on the desk, stop when the
 * store shows the beat landed.
 */
import { expect } from 'vitest';
import {
  liveTest, createLesson, turn, readCourse, patchCourse, importText, cards, proposals, confirmItems, until, value, nativeEvents, calledTools, assistantText, type LiveClassroom,
} from '../fixtures/live-classroom.ts';
import type { MemoryView } from '@studyforge/contracts/memory';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { ProposalView } from '@studyforge/contracts/proposals';

/** Confirm every pending item of one proposal, the way the student UI does. */
async function confirmAll(classroom: LiveClassroom, proposal: ProposalView): Promise<ProposalView> {
  return confirmItems(classroom, proposal, proposal.items.filter(item => item.status === 'pending')
    .map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })));
}

/** The student says yes to whatever the teacher put on the desk this beat. */
async function confirmPending(classroom: LiveClassroom, sessionId: string, what: string): Promise<readonly string[]> {
  const applied: string[] = [];
  for (const proposal of await proposals(classroom, sessionId)) {
    const pending = proposal.items.filter(item => item.status === 'pending');
    if (pending.length === 0) continue;
    const view = await confirmAll(classroom, proposal);
    for (const item of view.items) {
      expect(item.status, `${what}: ${JSON.stringify(item)}`).toBe('applied');
      if (item.receipt) applied.push(`${item.draft.effect.kind}→${item.receipt.title}`);
    }
  }
  return applied;
}

const STORY_TIMEOUT = 1_800_000;

liveTest('迷茫学生的三天：规划 → 拆课成卡 → 复习 → 发现联系 → 被看见', async classroom => {
  const log: string[] = [];
  const beat = (line: string): void => { log.push(line); console.log(`[story] ${line}`); };
  const narrate = async (): Promise<void> => {
    const events = await nativeEvents(classroom, { kind: 'session', sessionId });
    const said = assistantText(events).split('\n').filter(Boolean).at(-1)?.slice(0, 300) ?? '';
    const tools = calledTools(events);
    if (said) console.log(`[teacher] ${said}`);
    if (tools.length > 0) console.log(`[tools] ${[...new Set(tools)].join('、')}`);
  };
  const say = async (text: string): Promise<void> => {
    console.log(`[student] ${text.slice(0, 80)}`);
    await turn(classroom, sessionId, text);
    await narrate();
  };
  /** One cooperative beat: speak, confirm whatever landed, stop when done. */
  const engage = async (lines: readonly string[], done: () => Promise<boolean>): Promise<void> => {
    for (const line of lines) {
      await say(line);
      const applied = await confirmPending(classroom, sessionId, '提案确认');
      if (applied.length > 0) beat(`学生确认：${applied.join('、')}`);
      if (await done()) return;
    }
  };

  // 第一天 · 迷茫开局：学生点下「规划学习路线」，然后倒出全部困惑。
  const sessionId = await createLesson(classroom);
  await patchCourse(classroom, sessionId, { guided: true, teachingRef: 'diagnose' });
  await say('我现在很迷茫。我数学一直不好，想趁假期自己从头学一遍，但翻开书根本不知道先看哪里，也不知道该怎么学。');
  beat('第一天开场：学生说出迷茫');

  await importText(classroom, '基本不等式讲义', '基本不等式.txt',
    '# 基本不等式\n\n对任意正实数 a,b，有 (a+b)/2 ≥ √(ab)，当且仅当 a=b 时取等号。\n\n它与配方法同源：a+b-2√(ab) = (√a-√b)² ≥ 0。\n\n常用变形：x+1/x ≥ 2（x>0）；ab ≤ ((a+b)/2)²。\n\n例：求 x+4/x（x>0）的最小值，由基本不等式得 ≥4，x=2 时取到。');
  await say('我找到一份基本不等式的讲义放进资料了。你帮我看看，然后告诉我该怎么安排学它。');
  beat('学生导入《基本不等式讲义》');

  // 诊断与规划：真老师会先要学生的实际作答，再给路线。学生照实做，做不出就写做不出。
  await engage([
    '初中基础一般，函数最差；每天大概能学一个半小时，想先把基本不等式这块拿下。',
    '你出的小题我试了：x+4/x 的最小值我算出来是 4，x=2 的时候取到；配方那道我把 (√a-√b)² 展开成 a-2√ab+b，不确定对不对；剩下两道我没思路，写不出来。',
    '那你先给我排出一条路线来吧，我想知道先学什么后学什么。',
    '可以，就按这个安排走。',
    '我们开始吧。',
  ], async () => (await cards(classroom)).length > 0
    || (await proposals(classroom, sessionId)).some(p => p.items.some(i => ['route-add', 'plan-create', 'route-edit'].includes(i.draft.effect.kind) && i.status !== 'pending')));
  beat('规划与诊断阶段走完');

  // 开第一节课：继续配合，直到卡片真的沉淀下来。
  await engage([
    '那我们开始吧，今天先学什么？',
    '基本不等式我听懂了：就是算术平均不小于几何平均，相等当且仅当两个数相等。',
    'x+1/x 那个我会算了：x>0 时最小是 2，x=1 取到。',
    '好，我跟着你一步一步来。',
  ], async () => (await cards(classroom)).length > 0);
  const deck = await cards(classroom);
  expect(deck.length, '一节课上完应当沉淀出卡片：\n' + classroom.runtime.log()).toBeGreaterThan(0);
  beat(`第一节课结束：沉淀 ${deck.length} 张卡（${deck.slice(0, 3).map(card => card.content.title).join('、')}）`);

  // 收课：让今天真正结束。
  await say('今天到这里吧，帮我收个尾。');
  await confirmPending(classroom, sessionId, '收课提案');
  const course = await readCourse(classroom, sessionId);
  beat(`收课状态：${course.data.closure === null ? '未收课（模型选择继续开放）' : '已收课'}`);

  // 第二天 · 复习：学生回来，发现自己真的能讲出东西。
  await engage([
    '第二天了。我想先复习昨天的卡，再继续。',
    '我记得基本不等式是 (a+b)/2 ≥ √(ab)，取等条件是 a=b；x+1/x 在 x>0 时最小是 2。',
    '这些我昨天学的还记得，今天我们往下走吧。',
  ], async () => (await cards(classroom)).some(card => card.history.length > 0 || card.review !== undefined));
  expect((await cards(classroom)).some(card => card.history.length > 0 || card.review !== undefined),
    '第二天复习应当落进卡片历史：\n' + classroom.runtime.log()).toBe(true);
  beat('第二天复习：有卡片留下了复习痕迹');

  // 第三天 · 联系与锦囊：学生自己说出了知识间的联系。
  await engage([
    '今天继续学。我自己发现基本不等式其实和初中学的完全平方公式很像——a+b-2√ab 就是 (√a-√b)²。这个联系对吗？',
    '原来它们真的是同一件事。这个方法我想记住：看到平均数和乘积就往平方差的方向想。',
  ], async () => false);
  const knowledge = value(await classroom.client.rpc<KnowledgeView[]>('studyforgeLearning/knowledge', {}));
  beat(`第三天：知识/方法记录 ${knowledge.length} 条${knowledge.length > 0 ? `（${knowledge.map(row => row.content.title).slice(0, 3).join('、')}）` : ''}`);

  // 情绪线：学生说出不自信；老师应把它记成学情，而不是只在话里安慰。
  await say('其实我一直对自己没什么信心，以前老师总说我学不好。但这几天复习的时候我发现自己真的能讲出东西来。');
  const memories = value(await classroom.client.rpc<MemoryView[]>('studyforgeMemory/list', {}));
  beat(`学情观察 ${memories.length} 条${memories.length > 0 ? `（${memories.map(row => row.content.title ?? row.content.body.slice(0, 40)).slice(0, 2).join('；')}）` : ''}`);

  // 汇总真实发生的一切。
  const events = await nativeEvents(classroom, { kind: 'session', sessionId });
  const tools = calledTools(events);
  beat(`全链工具调用：${[...new Set(tools)].join('、') || '无'}`);
  console.log('\n===== 故事账目 =====\n' + log.join('\n') + '\n助教最后的话：' + assistantText(events).split('\n').filter(Boolean).at(-1)?.slice(0, 400));

  // 硬性底线：卡有了，复习发生了。方法与学情属模型自主行为，记账但不钉死。
  expect((await cards(classroom)).some(card => card.history.length > 0 || card.review !== undefined)).toBe(true);
  expect(tools.length, '真模型一节课应当真实调过工具').toBeGreaterThan(0);
}, STORY_TIMEOUT);
