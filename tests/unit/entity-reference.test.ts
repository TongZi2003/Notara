import { expect, test } from 'vitest';
import { entityHref, parseEntityHref, entityLink, entityReferenceText, type LibraryEntityReference } from '../../packages/contracts/src/entity-reference.ts';
import { entityReferenceContent } from '../../packages/host/src/tools/entity-reference-output.ts';
import { encodeSourceFragment, decodeSourceFragments } from '../../packages/contracts/src/source-context.ts';

test('portable references preserve object revisions, Unicode chapter paths and exact source coordinates', () => {
  const targets:LibraryEntityReference[] = [
    { kind: 'card', ref: 'card:one', version: 2 },
    { kind: 'knowledge', ref: 'knowledge:one', version: 3 },
    { kind: 'section', materialId: 'book', skeletonRevision: 4, path: '数学/三角函数/例2' },
    { kind: 'source', source: { materialId: 'book', versionId: 'v1', locator: { kind: 'pdf', page: 7, rect: [.1,.2,.8,.9] } } },
  ];
  for (const target of targets) expect(parseEntityHref(entityHref(target))).toEqual(target);
  expect(entityHref(targets[0]!)).not.toBe(entityHref({ kind:'card',ref:'card:one', version: 3 }));
  expect(entityLink('例[2] (a)', targets[0]!)).toContain('[例\\[2\\] (a)](#studyforge/reference/');
});

test('untrusted hrefs cannot supply paths, missing versions or a different entity kind', () => {
  for (const href of ['javascript:alert(1)', 'https://example.org', '#studyforge/reference/%%%', '#studyforge/reference/']) expect(parseEntityHref(href)).toBeUndefined();
  expect(() => entityHref({ kind: 'card', ref: 'knowledge:x', version: 1 } as never)).toThrow();
  expect(() => entityHref({ kind: 'card', ref: 'card:x' } as never)).toThrow();
  expect(() => entityHref({ kind: 'source', source: { materialId:'b',versionId:'v',path:'/tmp/a' } } as never)).toThrow();
});

test('inline labels stay readable in plain text without modifying code or ordinary links', () => {
  const link = entityLink('例[2]', { kind: 'card', ref: 'card:one', version: 1 });
  expect(entityReferenceText('参照' + link + '和[网站](https://example.org)。')).toBe('参照例[2]和[网站](https://example.org)。');
  for (const text of ['`' + link + '`', '```md\n' + link + '\n```', '[无效](#studyforge/reference/abc)']) expect(entityReferenceText(text)).toBe(text);
});

test('source quotes do not erase navigable tool output and large selections keep all identities', () => {
  const reference = { kind: 'source' as const, source: { materialId: 'book', versionId: 'v1', locator: { kind: 'pdf' as const, page: 2 } } };
  const blocks = entityReferenceContent({ source: { ...reference.source, quote: '正文' }, title: '原书' });
  expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining(entityLink('原书', reference)) }]);
  const entities = Array.from({ length: 35 }, () => ({ reference, title: '原书' }));
  const encoded = encodeSourceFragment({ version: 1, context: {}, titles: [], objects: [], entities });
  expect(decodeSourceFragments(encoded).fragments[0]?.entities).toHaveLength(35);
});
