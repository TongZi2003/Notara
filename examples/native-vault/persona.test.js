import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { PERSONA_TEXT_LIMIT, personaText, teacherPersona, workerPersona } from './persona.js';

const DEFAULT = '# 大肥鱼\n\n你是“大肥鱼”，一位爱吃白饭的鲸鱼娘女仆。';
const ROLE = '# 工作员共同规则\n\n你是授课老师派出的后台工作员，这次只做一件有边界的事。';

test('未设置老师人格时用默认形象，同一份配置永远得到同一段文本', () => {
  for (const settings of [{}, { persona: '' }, { persona: '   ' }, { persona: null }, undefined]) {
    assert.equal(teacherPersona(settings, DEFAULT), DEFAULT);
  }
  const once = teacherPersona({ persona: '你是一位严格的数学老师。' }, DEFAULT);
  assert.equal(once, teacherPersona({ persona: '你是一位严格的数学老师。' }, DEFAULT));
  // 没有默认正文时也不会拼出 undefined。
  assert.equal(teacherPersona(undefined, undefined), '');
});

test('自定义老师人格替换默认形象，只改风格，不覆盖职责、权限与真实性，仍按中文回应', () => {
  const custom = '你是一位严格的数学老师，称呼学生为同学。';
  const text = teacherPersona({ persona: custom }, DEFAULT);
  assert.ok(text.startsWith(custom), text);
  assert.doesNotMatch(text, /大肥鱼/);
  assert.match(text, /教学职责/);
  assert.match(text, /权限/);
  assert.match(text, /真实性/);
  assert.match(text, /中文/);
});

test('工作员人格拼在角色任务正文之后，空串只用任务角色', () => {
  for (const persona of ['', '   ', null, undefined, 42]) assert.equal(workerPersona(ROLE, persona), ROLE);
  const text = workerPersona(ROLE, '  说话简短，偶尔用比喻。  ');
  assert.equal(text.slice(0, ROLE.length), ROLE, '角色职责正文一个字都没被改写');
  assert.match(text, /## 独立人格/);
  assert.match(text, /说话简短，偶尔用比喻。/);
  assert.match(text, /工具范围/);
  assert.match(text, /中文/);
});

test('人格文本只去掉外层空白，上限是 4000 字', () => {
  assert.equal(PERSONA_TEXT_LIMIT, 4000);
  assert.equal(personaText('  一段人格  '), '一段人格');
  assert.equal(personaText('\n\t '), '');
  assert.equal(personaText(42), '');
  assert.equal(personaText(undefined), '');
  assert.equal(personaText('字'.repeat(PERSONA_TEXT_LIMIT)).length, PERSONA_TEXT_LIMIT);
});

test('persona.js 是纯模块，浏览器端引用它不会带进 Node 依赖', async () => {
  const source = await readFile(new URL('./persona.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, 'persona.js 不能有 import：默认正文由 Host 传入');
  assert.doesNotMatch(source, /require\s*\(/, 'persona.js 不能 require Node 模块');
  assert.doesNotMatch(source, /node:/, 'persona.js 不能引用 node: 内置模块');
});
