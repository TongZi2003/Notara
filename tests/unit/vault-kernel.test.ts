import { describe, expect, test } from 'vitest';
import { buildBacklinks, parseMarkdownDocument, projectTree, queryDocuments, revisionFor, safeRelativePath, searchDocuments } from '../../packages/domain/src/vault/vault-kernel.ts';

const source = `---\ntype: card\ntags: [向量, algebra]\nlearned: false\nmastery: 2\n---\n# 向量基础\n\n见 [[资料/点积]] 和 [[路线/第一课|第一课]]。\n\n- [ ] 写出定义\n- [x] 看过例题\n`;

describe('vault markdown kernel', () => {
  test('parses frontmatter, headings, tags, links and tasks', () => {
    const doc = parseMarkdownDocument('卡片/向量.md', source);
    expect(doc.title).toBe('向量基础');
    expect(doc.frontmatter).toMatchObject({ type: 'card', learned: false, mastery: 2 });
    expect(doc.tags).toEqual(expect.arrayContaining(['向量', 'algebra']));
    expect(doc.links).toEqual(['资料/点积', '路线/第一课']);
    expect(doc.tasks).toEqual([{ checked: false, text: '写出定义' }, { checked: true, text: '看过例题' }]);
  });

  test('rejects absolute and traversal paths', () => {
    expect(() => safeRelativePath('../secret.md')).toThrow('vault_path_invalid');
    expect(() => safeRelativePath('/secret.md')).toThrow('vault_path_invalid');
    expect(() => safeRelativePath('a\\b.md')).toThrow('vault_path_invalid');
  });

  test('searches and queries only the projected documents', () => {
    const first = parseMarkdownDocument('卡片/向量.md', source), second = parseMarkdownDocument('路线/第一课.md', '---\ntype: route\nstatus: active\n---\n# 第一课\n');
    expect(searchDocuments([first, second], '点积').hits.map(hit => hit.path)).toEqual(['卡片/向量.md']);
    expect(queryDocuments([first, second], { type: 'route', status: 'active' }).map(item => item.path)).toEqual(['路线/第一课.md']);
  });

  test('projects backlinks and a deterministic tree', () => {
    const first = parseMarkdownDocument('卡片/向量.md', source), second = parseMarkdownDocument('资料/点积.md', '# 点积\n\n[[卡片/向量]]');
    expect(buildBacklinks([first, second]).get('资料/点积')).toEqual(['卡片/向量.md']);
    expect(projectTree([first, second]).children.map(item => item.name)).toEqual(['卡片', '资料']);
    expect(revisionFor(source)).toBe(revisionFor(source));
    expect(revisionFor(source)).not.toBe(revisionFor(source + '!'));
  });
});
