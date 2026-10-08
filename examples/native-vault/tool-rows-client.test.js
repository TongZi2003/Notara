import assert from 'node:assert/strict';
import test from 'node:test';
import { STATUS_ROWS, statusRowText } from './tool-rows-client.js';

const call = { kind: 'tool-call' };
const result = (text, isError = false) => ({ kind: 'tool-result', isError, content: [{ type: 'text', text }] });

test('the teacher\'s own tools read as status, never as a tool name', () => {
  for (const key of ['save_lesson_summary', 'set_teaching_settings', 'open_learning_lesson', 'job_output', 'job_list', 'job_kill']) {
    assert.ok(STATUS_ROWS[key], `${key} has a status row`);
    for (const text of STATUS_ROWS[key]) assert.doesNotMatch(text, /[a-z]_[a-z]/);
  }
  assert.equal(statusRowText('save_lesson_summary', call), '正在保存课堂小结…');
  assert.equal(statusRowText('save_lesson_summary', result('{"saved":true}')), '已保存课堂小结');
  assert.equal(statusRowText('save_lesson_summary', result('failed', true)), '课堂小结没有保存成功');
  assert.equal(statusRowText('set_teaching_settings', result('{"revision":2}')), '已更新教学设置');
  assert.equal(statusRowText('open_learning_lesson', result('{"sessionId":"s","bound":true}')), '已打开这节课');
  assert.equal(statusRowText('open_learning_lesson', result('no route', true)), '这节课没有打开');
});

test('a lesson the Host declined to rebind is not reported as opened', () => {
  assert.equal(statusRowText('open_learning_lesson', result('{"sessionId":"s","bound":false,"reason":"这节课已经对应另一节"}')), '这节课没有换过来，原因见老师的说明');
  assert.equal(statusRowText('open_learning_lesson', { kind: 'tool-result', isError: false }), '已打开这节课');
});

test('history rows show Chinese status without querying or rendering private history content', () => {
  for (const key of ['history_search', 'history_read']) {
    assert.ok(STATUS_ROWS[key]);
    for (const text of STATUS_ROWS[key]) assert.doesNotMatch(text, /history_|seq|part|session|native-event|[a-z]_[a-z]/);
    const running = { kind: 'tool-call', get arguments() { throw new Error('private query/cursor must not be read'); } };
    const completed = { kind: 'tool-result', isError: false, get content() { throw new Error('private history evidence must not be rendered'); } };
    const failed = { kind: 'tool-result', isError: true, get content() { throw new Error('internal error codes must not be rendered'); } };
    assert.equal(statusRowText(key, running), STATUS_ROWS[key][0]);
    assert.equal(statusRowText(key, completed), STATUS_ROWS[key][1]);
    assert.equal(statusRowText(key, failed), STATUS_ROWS[key][2]);
  }
});
