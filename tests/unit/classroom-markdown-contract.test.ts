import { expect, test } from 'vitest';
import { ClassroomMarkdownViewSchema } from '../../packages/contracts/src/classroom-markdown.ts';

test('classroom Markdown output contains one material identity and no local path', () => {
  const view = ClassroomMarkdownViewSchema.parse({
    ref: 'material:mat_1234567890abcdef', materialId: 'mat_1234567890abcdef', versionId: 'ver_1234567890abcdef',
    revision: 1, title: '变化率', content: '# 变化率', source: { materialId: 'mat_1234567890abcdef', versionId: 'ver_1234567890abcdef' },
  });
  expect(view).not.toHaveProperty('path');
  expect(view.source).toEqual({ materialId: view.materialId, versionId: view.versionId });
});

test('classroom Markdown content and references stay bounded by the shared material contract', () => {
  expect(() => ClassroomMarkdownViewSchema.parse({
    ref: 'material:mat_1234567890abcdef', materialId: 'mat_1234567890abcdef', versionId: 'ver_1234567890abcdef',
    revision: 1, title: 'x', content: 'x', source: { materialId: 'mat_1234567890abcdef', versionId: 'ver_1234567890abcdef' }, extra: 'path',
  })).toThrow();
});
