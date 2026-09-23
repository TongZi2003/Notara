import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';

const block = lines => ['---', ...lines, '---', '# 标题', ''].join('\n');

test('keeps the historical flat subset: scalars, comments and string lists', () => {
  const content = ['---', '# 注释', '', 'type: route', 'title: 向量路线', 'status: draft', 'tags: [math, vector]', 'date: 2026-09-21', 'weight: 2.5', 'active: true', 'archived: null', 'empty:', '---', '# 向量路线', ''].join('\n');
  const { frontmatter, body } = parseFrontmatter(content);
  assert.deepEqual(frontmatter, {
    type: 'route', title: '向量路线', status: 'draft', tags: ['math', 'vector'],
    date: '2026-09-21', weight: 2.5, active: true, archived: null, empty: '',
  });
  assert.equal(body, '# 向量路线\n');
  assert.deepEqual(parseFrontmatter('#' + ' 没有属性\n').frontmatter, {});
});

test('reads single-line JSON arrays, including nodes with nested values', () => {
  const lessons = [{ id: 'n1', title: '第一课', materials: ['资料/定义.md'] }, { id: 'n2', title: '第二课', parent: 'n1', materials: [] }];
  const { frontmatter } = parseFrontmatter(block([`lessons: ${JSON.stringify(lessons)}`]));
  assert.deepEqual(frontmatter.lessons, lessons);

  const quoted = parseFrontmatter(block(['tags: ["解析几何", "选路"]'])).frontmatter;
  assert.deepEqual(quoted.tags, ['解析几何', '选路']);

  const nested = parseFrontmatter(block(['meta: {"a":[1,true,null],"b":{"c":"d"}}'])).frontmatter;
  assert.deepEqual(nested.meta, { a: [1, true, null], b: { c: 'd' } });
});

test('rejects structured values it cannot read instead of guessing or skipping', () => {
  // A multi-line block sequence is still outside the flat subset: the file is
  // reported, never partially indexed.
  assert.throws(() => parseFrontmatter(block(['lessons:', '  - id: n1', '    title: 第一课'])), /vault_frontmatter_invalid/);
  assert.throws(() => parseFrontmatter(block(['meta: {oops}'])), /vault_frontmatter_invalid/);
  assert.throws(() => parseFrontmatter(block(['tags: [{"id":"n1"}, bare]'])), /vault_frontmatter_invalid/);
  assert.throws(() => parseFrontmatter(block(['tags: [1, 2]', 'tags: [3]'])), /vault_frontmatter_invalid/);
  assert.throws(() => parseFrontmatter(block(['bad key: 1'])), /vault_frontmatter_invalid/);
  assert.throws(() => parseFrontmatter(block(['没有冒号'])), /vault_frontmatter_invalid/);
  assert.throws(() => parseFrontmatter('---\ntype: route\n'), /vault_frontmatter_invalid/);
});

test('double-quoted scalars follow JSON escaping while single quotes stay literal', () => {
  assert.equal(parseFrontmatter(block(['title: "a\\"b"'])).frontmatter.title, 'a"b');
  assert.equal(parseFrontmatter(block(['title: "换行\\n符号"'])).frontmatter.title, '换行\n符号');
  assert.equal(parseFrontmatter(block(["title: 'a\"b'"])).frontmatter.title, 'a"b');
  assert.equal(parseFrontmatter(block(['title: "未闭合'])).frontmatter.title, '"未闭合');
});

test('serializes the same subset it reads, on one line per property', () => {
  const frontmatter = {
    type: 'route',
    title: '圆锥曲线路线',
    status: 'draft',
    tags: ['math', 'vector'],
    count: 2,
    active: true,
    archived: null,
    note: '含,逗号',
    quoted: 'true',
    lessons: [{ id: 'n1', title: '第一课, 带逗号', materials: ['资料/定义.md'] }],
  };
  const text = serializeFrontmatter(frontmatter);
  assert.ok(text.startsWith('---\n') && text.endsWith('---\n'));
  assert.equal(text.split('\n').filter(line => line.startsWith('lessons: ')).length, 1);
  assert.deepEqual(parseFrontmatter(text).frontmatter, frontmatter);
  assert.deepEqual(parseFrontmatter(`${text}# 圆锥曲线路线\n`).body, '# 圆锥曲线路线\n');
  assert.equal(serializeFrontmatter({}), '---\n---\n');
  assert.deepEqual(parseFrontmatter(serializeFrontmatter({})).frontmatter, {});

  // Round-tripping keeps key order, so a re-written page reads back byte-stable.
  const again = serializeFrontmatter(parseFrontmatter(text).frontmatter);
  assert.equal(again, text);
});

test('refuses to write properties the reader could not read back', () => {
  assert.throws(() => serializeFrontmatter({ 'bad key': 1 }), /vault_frontmatter_invalid/);
  assert.throws(() => serializeFrontmatter({ missing: undefined }), /vault_frontmatter_invalid/);
  assert.throws(() => serializeFrontmatter({ huge: 1e21 }), /vault_frontmatter_invalid/);
  assert.throws(() => serializeFrontmatter({ bad: Number.NaN }), /vault_frontmatter_invalid/);
  assert.throws(() => serializeFrontmatter(['type: route']), /vault_frontmatter_invalid/);
});
