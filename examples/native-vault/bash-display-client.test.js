import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bashStep, createBashStep } from './bash-display-client.js';

const argsRaw = JSON.stringify({ description: '[notara:review-record] ### 记录这次作答并安排复习', command: 'PRIVATE_COMMAND' });
const running = { name: 'bash', argsRaw };
const result = (extra = {}) => ({ kind: 'tool-result', call: { name: 'bash', argsRaw }, content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }], isError: false, ...extra });

test('标题提示与运行事实分离，普通返回不声称学习任务完成', () => {
  assert.equal(bashStep(running).title, '记录这次作答并安排复习');
  assert.equal(bashStep(running).state, 'running');
  assert.equal(bashStep(result()).status, '已返回');
  assert.equal(bashStep(result({ error: { code: 'interrupted' } })).state, 'stopped');
  assert.equal(bashStep(result({ isError: true })).state, 'error');
});

test('普通 tool result 中非零退出、终止信号与超时不能伪装成功', () => {
  for (const text of ['output\n[exit code: 7]', 'output\n[killed by signal: SIGTERM]']) {
    assert.equal(bashStep(result({ content: [{ type: 'text', text }] })).state, 'error');
  }
  assert.equal(bashStep(result({ meta: { exitCode: 2 } })).state, 'error');
  assert.equal(bashStep(result({ meta: { timedOut: true } })).state, 'error');
  assert.equal(bashStep(result({ meta: { aborted: true } })).state, 'stopped');
});

test('参数不完整、无标记、历史记录缺 call 时回到原生组件', () => {
  const Native = props => React.createElement('p', null, props.nativeValue);
  const Component = createBashStep(React, Native);
  for (const block of [null, { argsRaw: '{"description":' }, { argsRaw: 'null' }, { argsRaw: JSON.stringify({ description: '普通命令', command: 'ls' }) }, result({ call: null })]) {
    assert.equal(bashStep(block), null);
    assert.equal(renderToStaticMarkup(React.createElement(Component, { block, nativeValue: 'native fallback' })), '<p>native fallback</p>');
  }
});

test('用途直接作为折叠按钮，默认不渲染命令输出或标识，描述作为纯文本', () => {
  const Component = createBashStep(React, () => null);
  const html = renderToStaticMarkup(React.createElement(Component, { block: result() }));
  assert.match(html, /<span class="nv-bash-title">记录这次作答并安排复习<\/span>/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /PRIVATE_|notara:review-record|###|<h3|<strong|已返回|查看执行详情/);
  const malicious = { argsRaw: JSON.stringify({ description: '[notara:other] <img src=x onerror=alert(1)>', command: 'true' }) };
  const escaped = renderToStaticMarkup(React.createElement(Component, { block: malicious }));
  assert.match(escaped, /&lt;img/);
  assert.doesNotMatch(escaped, /<img/);
});
