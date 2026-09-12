/**
 * P7 scenario: the main lesson really searches with the native web tool and
 * cites a live source, and a search delegate really runs as its own child
 * session that searched on its own.
 *
 * The child log is read through its durable subagent address; a child session
 * cannot be read as a plain session.
 */
import { expect } from 'vitest';
import {
  liveTest, createLesson, turn, until, calledTools, toolResults, nativeEvents, subagentAddress, value,
} from '../fixtures/live-classroom.ts';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';

const URL = /https?:\/\/[^\s"'\\]+/;

liveTest('主搜索追问与子搜索都留下真实来源（native tool/call + tool/result）', async classroom => {
  const sessionId = await createLesson(classroom);

  const main = await turn(classroom, sessionId,
    '用 web_search 查一下正弦定理的常见表述，然后告诉我你实际引用的那个真实链接。');
  expect(calledTools(main.events), classroom.runtime.log()).toContain('web_search');
  expect(toolResults(main.events).join('\n'), classroom.runtime.log()).toMatch(URL);
  // A follow-up question keeps the same lesson and still sees the earlier source.
  const followUp = await turn(classroom, sessionId, '刚才那个链接里，哪一句是定义？用一句话回答。');
  expect(preparedHasLink(followUp.events), classroom.runtime.log()).toBe(true);

  const before = value(await classroom.client.rpc<SessionListValue>('session/list', { _request: {} })).items.length;
  const delegated = await turn(classroom, sessionId,
    '再用 delegate_search 派一个只做检索的子代理，让它自己查余弦定理并带回它实际引用的真实链接。');
  expect(calledTools(delegated.events)).toContain('delegate_search');

  const child = await until(classroom, 'search delegate session did not appear', async () => {
    const items = value(await classroom.client.rpc<SessionListValue>('session/list', { _request: {} })).items;
    const subagents = items.filter(item => item.origin === 'subagent' && item.parentSessionId === sessionId);
    return items.length > before && subagents.length > 0 ? subagents[0] : undefined;
  });
  const address = await subagentAddress(classroom, sessionId, String(child!.sessionId));
  const childEvents = await until(classroom, 'child search produced no real source', async () => {
    const events = await nativeEvents(classroom, address);
    return calledTools(events).includes('web_search') && URL.test(toolResults(events).join('\n')) ? events : undefined;
  });
  expect(calledTools(childEvents)).toContain('web_search');
});

/** The follow-up request still carries the earlier real link in its history. */
function preparedHasLink(events: readonly { type: string; data: unknown }[]): boolean {
  return events.some(event => event.type === 'tool/result' && URL.test(JSON.stringify(event.data)));
}
