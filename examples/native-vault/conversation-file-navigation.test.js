import assert from 'node:assert/strict';
import test from 'node:test';

import { attachConversationFileNavigation, conversationVaultTarget, vaultConversationAssetPath } from './conversation-file-navigation.js';

/** Minimal DOM double: only the selectors this module is allowed to use. */
function matches(node, selector) {
  if (selector === 'button[title]') return node.tagName === 'BUTTON' && typeof node.title === 'string';
  if (selector === 'code') return node.tagName === 'CODE';
  if (selector === '[data-produced-files-row]') return node.data['data-produced-files-row'] === true;
  if (selector === '[data-presented-file]') return node.data['data-presented-file'] === true;
  throw new Error(`fake DOM does not implement ${selector}`);
}

function el(tag, options = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    title: options.title,
    data: options.data ?? {},
    parentNode: null,
    closest(selector) {
      for (let current = node; current; current = current.parentNode) if (matches(current, selector)) return current;
      return null;
    },
    getAttribute(name) {
      if (name === 'title') return options.title ?? null;
      return node.data[name] ?? null;
    },
  };
  node.children = children.map(child => { child.parentNode = node; return child; });
  return node;
}

/** Icon span inside a chip button: the click target is not the button itself. */
const icon = () => el('span');

function pane() {
  const listeners = new Set();
  return {
    addEventListener(type, listener) { listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); },
    click(target) {
      const event = {
        target,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
      };
      for (const listener of [...listeners]) listener(event);
      return event;
    },
  };
}

const mention = title => el('code', {}, [el('button', { title }, [icon()])]);
const producedChip = title => el('div', { data: { 'data-produced-files-row': true } }, [el('button', { title }, [icon()])]);

test('只有 vault/ 下的相对路径进入资产页，绝对路径与穿越路径留在原生路由', () => {
  assert.equal(vaultConversationAssetPath('vault/卡片/甲.md'), '卡片/甲.md');
  assert.equal(vaultConversationAssetPath('vault/媒体/讲义.pdf#page=2'), '媒体/讲义.pdf#page=2');
  assert.equal(vaultConversationAssetPath('vault/知识/向量.md'), '知识/向量.md');
  for (const rejected of [
    '卡片/甲.md',
    '/Users/teacher/教培资料/vault/卡片/甲.md',
    'vault/',
    'vault/../秘密.md',
    'vault/卡片/../../秘密.md',
    'vault//双斜杠.md',
    'vault/./当前.md',
    'vault/卡片\\甲.md',
    'vault/C:/卡片/甲.md',
    'https://example.com/vault/卡片/甲.md',
    undefined,
    null,
    7,
  ]) {
    assert.equal(vaultConversationAssetPath(rejected), null, `${String(rejected)} 不应被接管`);
  }
});

test('只有对话产出链接的两种形状被识别，present 卡片与普通按钮不接管', () => {
  const mentioned = mention('vault/卡片/甲.md');
  assert.equal(conversationVaultTarget(mentioned.children[0]), '卡片/甲.md');
  // 点击落在图标上时仍然命中外层按钮。
  assert.equal(conversationVaultTarget(mentioned.children[0].children[0]), '卡片/甲.md');

  const chipped = producedChip('vault/卡片/乙.md');
  assert.equal(conversationVaultTarget(chipped.children[0]), '卡片/乙.md');

  // present 交付卡使用绝对路径，且带"用默认应用打开"的动作语义。
  const presented = el('div', { data: { 'data-presented-file': true } }, [el('button', { title: '/Users/teacher/教培资料/vault/卡片/甲.md' })]);
  assert.equal(conversationVaultTarget(presented.children[0]), null);
  // 相对路径但不在产出链接结构里（例如输入框里的引用 chip）同样不接管。
  assert.equal(conversationVaultTarget(el('div', {}, [el('button', { title: 'vault/卡片/甲.md' })])), null);
  assert.equal(conversationVaultTarget(null), null);
  assert.equal(conversationVaultTarget(el('span')), null);
});

test('点击产出卡在原生打开器之前停住，并交出 Vault 相对路径', () => {
  const content = pane();
  const opened = [];
  const detach = attachConversationFileNavigation(content, { open: path => opened.push(path) });
  const chip = producedChip('vault/卡片/坐标.md');
  const event = content.click(chip.children[0].children[0]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(opened, ['卡片/坐标.md']);
  detach();
  assert.deepEqual(opened, ['卡片/坐标.md'], 'detach 后不再接管');
  const after = content.click(chip.children[0]);
  assert.equal(after.defaultPrevented, false);
  assert.equal(after.propagationStopped, false);
});

test('非 Vault 文件与外部形状保持原生路由：不拦截、不转移', () => {
  const content = pane();
  const opened = [];
  attachConversationFileNavigation(content, { open: path => opened.push(path) });
  for (const target of [
    producedChip('卡片/甲.md').children[0],
    mention('知识/向量.md').children[0],
    mention('/Users/teacher/教培资料/vault/卡片/甲.md').children[0],
    el('button', { title: 'vault/卡片/甲.md' }),
  ]) {
    const event = content.click(target);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
  }
  assert.deepEqual(opened, []);
});

test('没有可挂载容器时返回空 detach，不抛错', () => {
  const detach = attachConversationFileNavigation(undefined, { open: () => { throw new Error('不应调用'); } });
  assert.equal(typeof detach, 'function');
  detach();
});
