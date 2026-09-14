import { expect, test } from 'vitest';
import { createElement } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

const prefix = '#studyforge/reference/';
// Execute the installed renderer functions without importing the package's
// browser-only peer graph. Full parsing/streaming is checked in the actual UI.
const source = readFileSync(new URL('../../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js', import.meta.url), 'utf8');
const safe = source.slice(source.indexOf('function sanitizeUrl(url)'), source.indexOf('function remoteImageUrl(url)'));
const links = source.slice(source.indexOf('function renderSafeLink(href'), source.indexOf('function renderAnchor(url'));
const pending = source.includes('function sfPendingReference(text)') ? source.slice(source.indexOf('function sfPendingReference(text)'), source.indexOf('function renderSafeLink(href')) : 'function sfPendingReference(text){return text;}';
const native = new Function('jsx','jsxs','Fragment$1','LinkIcon','css$23', safe + pending + links + ';return {link:renderSafeLink,pending:sfPendingReference};')(jsx,jsxs,Fragment,()=>null,{}) as {link:(href:string,children:string[],key:string)=>React.ReactNode;pending:(text:string)=>string};
test('native Markdown keeps readable entity links in the current app, while unsafe URLs stay inert', () => {
  const html = renderToStaticMarkup(createElement('div',{},native.link(prefix+'YWJj',['例2'],'a'),native.link('https://example.org',['外部'],'b'),native.link('javascript:alert(1)',['坏链接'],'c')));
  expect(html).toContain('data-studyforge-reference=');
  expect(html).toContain('href="' + prefix + 'YWJj"');
  expect(html).toContain('target="_blank"');
  expect(html).not.toContain('href="javascript:');
});
test('an unfinished internal destination never appears as machine text during streaming', () => {
  const html = native.pending('先看[例2](' + prefix + 'YWJj');
  expect(html).toContain('例2');
  expect(html).not.toContain('YWJj');
  expect(native.pending('`[示例](' + prefix + 'YWJj')).toContain('YWJj');
  expect(native.pending('```md\n[示例](' + prefix + 'YWJj')).toContain('YWJj');
});
