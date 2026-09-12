/**
 * P7 scenario: the lesson's real teaching configuration and its temporary
 * requirement both reach the prepared request, and switching the configuration
 * changes only the *next* request.
 *
 * The assertion reads the rendered `system/message` from the native log — the
 * exact prepared prompt — and the teaching text it compares against is read
 * from the same isolated runtime's installed presets, so it can only pass if
 * the real teaching body was really assembled.
 */
import { expect } from 'vitest';
import {
  liveTest, createLesson, patchCourse, readCourse, preparedSystemPrompt, teachingPresetBody, firstBodyLine, turn,
} from '../fixtures/live-classroom.ts';

const ORGANIZE = '本课请先给结论，再给我一步可操作的动作；不要一次讲完。';
const SOCRATIC = '本课改成先让我自己写一步，再给判断。';

liveTest('同课教法与临时要求进入 prepared 请求，切教法只影响下一轮', async classroom => {
  const sessionId = await createLesson(classroom);
  const organizeBody = firstBodyLine(await teachingPresetBody(classroom, 'organize'));
  const socraticBody = firstBodyLine(await teachingPresetBody(classroom, 'socratic'));

  const first = await patchCourse(classroom, sessionId, { teachingRef: 'organize', temporaryInstructions: ORGANIZE });
  expect(first.data.teachingRef, classroom.runtime.log()).toBe('organize');
  const firstPrompt = preparedSystemPrompt((await turn(classroom, sessionId, '用一句话说明这节课你打算怎么带我。')).events);
  expect(firstPrompt, classroom.runtime.log()).toContain(organizeBody);
  expect(firstPrompt).toContain(ORGANIZE);
  expect(firstPrompt).not.toContain(socraticBody);

  const second = await patchCourse(classroom, sessionId, { teachingRef: 'socratic', temporaryInstructions: SOCRATIC });
  expect(second.data.teachingRef).toBe('socratic');
  expect((await readCourse(classroom, sessionId)).data.teachingRef).toBe('socratic');
  const secondPrompt = preparedSystemPrompt((await turn(classroom, sessionId, '按新的要求再说一次你打算怎么带我。')).events);
  expect(secondPrompt, classroom.runtime.log()).toContain(socraticBody);
  expect(secondPrompt).toContain(SOCRATIC);
  expect(secondPrompt).not.toContain(organizeBody);
});
