import { expect, test } from 'vitest';
import { decodeSourceFragments, encodeSourceFragment, type SourceFragment } from '../../packages/contracts/src/source-context.ts';

test('a native reference freezes selected version and original text without becoming the student answer', () => {
  const fragment: SourceFragment = { version: 1, objects: [], titles: [{ ref: 'material:m', title: '函数' }], context: { selection: {
    text: '原文\n```也属于原文', sources: [{ materialId: 'm', versionId: 'v1', locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 5 } } }],
  } } };
  const encoded = encodeSourceFragment(fragment);
  fragment.context.selection!.sources[0]!.versionId = 'v2';
  const decoded = decodeSourceFragments('我的下一步是求导。' + encoded);
  expect(decoded.text.trim()).toBe('我的下一步是求导。');
  expect(decoded.fragments[0]?.context.selection?.sources[0]?.versionId).toBe('v1');
  expect(decoded.fragments[0]?.context.selection?.text).toBe('原文\n```也属于原文');
});

test('malformed, incomplete and ordinary code is never silently stripped', () => {
  for (const source of ['```studyforge-source\n{bad}\n```', '```studyforge-source\n{"version":1}\n```', '```studyforge-source\n{}', '```json\n{"context":"student wrote this"}\n```']) {
    expect(decodeSourceFragments(source)).toEqual({ text: source, fragments: [] });
  }
});

test('multiple explicit references keep their own immutable locations and order', () => {
  const at = (page: number): SourceFragment => ({ version: 1, objects: [], titles: [], context: { currentMaterial: { kind: 'source', source: { materialId: 'm', versionId: 'v1', locator: { kind: 'pdf', page } } } } });
  const decoded = decodeSourceFragments(encodeSourceFragment(at(8)) + '比较这两页' + encodeSourceFragment(at(2)));
  expect(decoded.fragments.map(fragment => fragment.context.currentMaterial)).toEqual([at(8).context.currentMaterial, at(2).context.currentMaterial]);
  expect(decoded.text.trim()).toBe('比较这两页');
});
