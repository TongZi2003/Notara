import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The client imports its stylesheet as text (esbuild's loader); Node gets an empty one.
registerHooks({ load: (url, context, next) => url.endsWith('.css') ? { format: 'module', source: 'export default "";', shortCircuit: true } : next(url, context) });
globalThis.document ??= { hidden: false };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { createTodayEntry } = await import('./today-entry-client.js');
const h = React.createElement, TodayEntry = createTodayEntry(React);

test('a draft that could not go into the composer is announced beside the ready composer', () => {
  const draftNotice = '没能放进输入框，直接在输入框里说“帮我规划一条学习路线”就好。';
  const ready = renderToStaticMarkup(h(TodayEntry, { visible: true, composerReady: true, draftNotice }, h('div', null, '输入框')));
  assert.match(ready, /role="alert"[^>]*>没能放进输入框/);
  assert.ok(ready.indexOf('输入框</div>') < ready.indexOf('没能放进输入框'), 'below the composer it concerns');
  // The preparing slot keeps saying what it is doing; a draft is no reason to offer 重试.
  const preparing = renderToStaticMarkup(h(TodayEntry, { visible: true, composerReady: false, draftNotice }));
  assert.match(preparing, /role="status"[^>]*>正在准备输入框…/);
  assert.doesNotMatch(preparing, /重试/);
});
