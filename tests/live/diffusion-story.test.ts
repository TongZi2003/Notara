/**
 * The diffusion story, played against the real model: a self-directed
 * university student arrives with a terminal goal — "learn the history of AI
 * agents, then rewrite a minimal pi-core-style agent kernel in rust" — and the
 * diffusion preset should lay a trunk derived from that endpoint, let tangents
 * become confirmed branch proposals, leave named pits instead of silent skips,
 * and finally compile the walked trajectory into a self-made material.
 *
 * Every beat is a cooperative loop like the student story: say the next honest
 * line, confirm whatever the teacher put on the desk, stop when the store shows
 * the beat landed. Model-authored teaching is observed, never scripted.
 */
import { expect } from 'vitest';
import {
  liveTest, createLesson, turn, readCourse, patchCourse, cards, proposals, confirmItems, value, nativeEvents, calledTools, assistantText, type LiveClassroom,
} from '../fixtures/live-classroom.ts';
import type { LearningPath } from '@studyforge/contracts/courses';
import type { MemoryView } from '@studyforge/contracts/memory';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { ProposalView } from '@studyforge/contracts/proposals';

async function confirmAll(classroom: LiveClassroom, proposal: ProposalView): Promise<ProposalView> {
  return confirmItems(classroom, proposal, proposal.items.filter(item => item.status === 'pending')
    .map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })));
}

async function confirmPending(classroom: LiveClassroom, sessionId: string, what: string): Promise<readonly string[]> {
  const applied: string[] = [];
  for (const proposal of await proposals(classroom, sessionId)) {
    if (proposal.items.every(item => item.status !== 'pending')) continue;
    const view = await confirmAll(classroom, proposal);
    for (const item of view.items) {
      expect(item.status, `${what}: ${JSON.stringify(item)}`).toBe('applied');
      if (item.receipt) applied.push(`${item.draft.effect.kind}→${item.receipt.title}`);
    }
  }
  return applied;
}

const paths = async (classroom: LiveClassroom): Promise<LearningPath[]> =>
  value(await classroom.client.rpc<LearningPath[]>('studyforgeCourses/learningPaths', {}));
const materials = async (classroom: LiveClassroom): Promise<MaterialView[]> =>
  value(await classroom.client.rpc<MaterialView[]>('studyforgeMaterials/list', {}));

const STORY_TIMEOUT = 1_800_000;

liveTest('扩散式学习：agent 前世今生 → rust 重写 pi core', async classroom => {
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
  const engage = async (lines: readonly string[], done: () => Promise<boolean>): Promise<void> => {
    for (const line of lines) {
      await say(line);
      const applied = await confirmPending(classroom, sessionId, '提案确认');
      if (applied.length > 0) beat(`学生确认：${applied.join('、')}`);
      if (await done()) return;
    }
  };

  // 开场：自学者带着终点来——不是迷茫，是明确的扩散目标。
  const sessionId = await createLesson(classroom);
  await patchCourse(classroom, sessionId, { guided: true, teachingRef: 'diffusion' });
  await say('我想学 AI agent 的前世今生，从前缀补齐一路到 coding agent 和 harness 那套。终点很明确：最后我要能用 rust 重写一个极简的 agent 内核，类似 pi core。我大三，python 很熟，rust 写过一个命令行小工具，机器学习只上过一门导论课。');
  beat('开场：学生给出终点任务与自身基础');

  // 主干铺设：老师应当先问影响计划的缺口，再用 propose_route 铺链。
  await engage([
    '一周大概能学四五次，每次两小时上下。',
    '好，把主干排出来我看看。',
    '可以，就按这条主干走，我们开始第一站。',
  ], async () => (await paths(classroom)).some(path => path.lessons.length > 0));
  const route = await paths(classroom);
  const planned = route.flatMap(path => path.lessons.map(lesson => lesson.title));
  beat(`主干落地：${planned.length} 站（${planned.slice(0, 6).join('、')}）`);
  expect(planned.length, '扩散课应当铺出主干路线：\n' + classroom.runtime.log()).toBeGreaterThan(0);

  // 第一站学习：跟着前缀补齐走，顺带观察学情与认知沉淀。
  await engage([
    '那我们从第一站开始。',
    '前缀补齐我懂了：模型就是在已有文本上预测下一个 token，所谓"生成"其实是不断续写。',
    '那按这个逻辑，chatbot 其实是在补齐"对话格式"这个模式？把问答包装成前缀？',
    '好，下一站。',
  ], async () => (await value(await classroom.client.rpc<KnowledgeView[]>('studyforgeLearning/knowledge', {}))).length > 0
    || (await value(await classroom.client.rpc<MemoryView[]>('studyforgeMemory/list', {}))).length > 0);
  beat('第一站学完：认知或学情已开始沉淀');

  // 半路疑问：GPT-1 时代的问题——观察它是提案分支还是直接展开。
  await engage([
    '插一句：我一直好奇 GPT-1 刚出来那会儿，学界真的相信 scale 这条路吗？这段要不要单独开一站讲？',
    '你看着安排，值得开就开一站，不值得就先记着。',
  ], async () => false);
  const branchPaths = await paths(classroom);
  const branchCount = branchPaths.flatMap(path => path.lessons).length;
  beat(`半路疑问后路线共 ${branchCount} 站（分支是否被提案确认，见上方提案记录）`);

  // 走到 GPT-3 附近：观察主干是否收向应用层、infra 深坑是否留名。
  await engage([
    '继续走主干，现在该到 GPT-3 前后了吧。',
    '大规模预训练那些 infra 和技巧，我们先不深挖——但你说的对，值得留个名字以后回来。',
    '往下走，langgraph 和 coding agent 才是我要去的地方。',
  ], async () => false);
  const knowledge = value(await classroom.client.rpc<KnowledgeView[]>('studyforgeLearning/knowledge', {}));
  const pits = knowledge.filter(row => /坑|不入|不深入|跳过/.test(row.content.title + row.content.body));
  beat(`坑笔记：${pits.length} 条${pits.length > 0 ? `（${pits.map(row => row.content.title).join('、')}）` : '（未观察到留名）'}`);

  // 收口：看终点站与轨迹成书是否发生。
  await engage([
    '今天差不多了。我沿途记的笔记和方法，你帮我整理成一份我能回头再学的东西。',
    '成书也好，材料也好，存进资料库就行。',
  ], async () => (await materials(classroom)).length > 0);
  const lib = await materials(classroom);
  beat(`资料库现有 ${lib.length} 份材料${lib.length > 0 ? `（${lib.map(row => row.title).slice(0, 4).join('、')}）` : ''}`);

  // 汇总真实发生的一切。
  const events = await nativeEvents(classroom, { kind: 'session', sessionId });
  const tools = calledTools(events);
  const memories = value(await classroom.client.rpc<MemoryView[]>('studyforgeMemory/list', {}));
  beat(`全链工具调用：${[...new Set(tools)].join('、') || '无'}`);
  beat(`学情 ${memories.length} 条、知识 ${knowledge.length} 条、材料 ${lib.length} 份、路线 ${branchCount} 站`);
  console.log('\n===== 扩散故事账目 =====\n' + log.join('\n') + '\n助教最后的话：' + assistantText(events).split('\n').filter(Boolean).at(-1)?.slice(0, 400));

  // 硬性底线：路线落地了，真实工具调用发生了。坑笔记/成书属模型自主行为，记账但不钉死。
  expect(planned.length).toBeGreaterThan(0);
  expect(tools.length, '真模型一节课应当真实调过工具').toBeGreaterThan(0);
}, STORY_TIMEOUT);
