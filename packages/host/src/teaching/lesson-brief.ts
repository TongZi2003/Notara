/**
 * P7.5 next-lesson brief (plan §P7.5, CONTRACTS.md §7).
 *
 * A lesson that continues another receives ONE exact handoff revision when it
 * opens, and keeps receiving that revision. A later correction of the summary
 * writes a new immutable revision on the same ref; it never re-points a lesson
 * that already took the older one. So the brief is read through the lesson's own
 * fixed pin (`readPinned`), never through "the latest version of that ref".
 *
 * The brief is teacher-side context (system prompt), not student copy: it names
 * the previous summary, the instant and native sequence the summary accounted
 * for, and the system facts that were really held then. The free body stays the
 * teacher's own words; nothing here invents a conclusion the summary did not
 * carry.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import type { HandoffPin, HandoffView } from '@studyforge/contracts/handoffs';

/** What the brief needs from the saved-summary reader; the real `HandoffService` satisfies it. */
export interface PinnedHandoffReader {
  readPinned(ctx: HostContext, pin: HandoffPin): HandoffView;
}

/** One lesson's fixed view of the summary it continued from. */
export interface ContinuationBrief {
  /** The exact revision this lesson received; never re-resolved to a later one. */
  readonly pin: HandoffPin;
  readonly handoff: HandoffView;
  /** Teacher-side rendering, ready to append to the lesson's system prompt. */
  readonly text: string;
}

const FACT_LABEL = { material: '材料', saved: '已保存', pending: '待确认' } as const;

/** Render one pinned summary as teacher-side briefing text. */
export function renderHandoffBrief(handoff: HandoffView, pin: HandoffPin): string {
  const facts = handoff.facts.length === 0 ? '（当时没有别的材料或待确认项）'
    : handoff.facts.map(fact => fact.target ? `${FACT_LABEL[fact.kind]}《${fact.title}》(${fact.target})` : `${FACT_LABEL[fact.kind]}《${fact.title}》`).join('；');
  return [
    `上一课的小结：《${handoff.title}》第 ${pin.version} 版（${handoff.ref}）`,
    '老师当时写的正文：',
    handoff.body,
    `这份小结写到的真实输入截止点：${handoff.cutoff.at}（原生日志第 ${handoff.cutoff.sequence} 条）`,
    `当时系统真正持有的东西：${facts}`,
    '这是上一课固定下来的版本；之后有人更正过小结也不改变本课收到的这一版。',
  ].join('\n');
}

/**
 * The brief for one native lesson, or `undefined` when it continues nothing.
 * @throws `handoff_missing`（course 行不存在）及读取端自己的错误：接续版本读不到时
 *   宁可报错，也不静默换成"最新一版"。
 */
export function continuationBrief(host: Context, ctx: HostContext): ContinuationBrief | undefined {
  const pin = host.studyforgeCourseMetadata.read(ctx).data.continuation;
  if (pin === undefined) return undefined;
  const handoff = host.studyforgeHandoffService.readPinned(ctx, pin);
  return { pin, handoff, text: renderHandoffBrief(handoff, pin) };
}
