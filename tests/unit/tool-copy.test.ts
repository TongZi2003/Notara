import { describe, expect, it } from 'vitest';
import { prettyToolArguments, toolDisplayCopy } from '../../packages/client/src/classroom/tool-copy.ts';

describe('student tool progress', () => {
  it('does not claim persistence for any prepared proposal', () => {
    for (const name of ['propose_card', 'propose_review', 'propose_set', 'propose_plan', 'propose_route', 'propose_skeleton', 'propose_handoff', 'propose_lesson_settings']) {
      expect(toolDisplayCopy(name, 'ok')).toContain('提案已准备好');
      expect(toolDisplayCopy(name, 'ok')).not.toMatch(/已保存|已记下/);
    }
  });
  it('distinguishes a running action, failure, interruption and dispatch', () => {
    expect(toolDisplayCopy('read_material', 'running')).toBe('正在阅读原文…');
    expect(toolDisplayCopy('read_material', 'error')).toBe('这次没能阅读原文');
    expect(toolDisplayCopy('read_material', 'stopped')).toBe('已停止：阅读原文');
    expect(toolDisplayCopy('subagent', 'ok')).toBe('已交给帮手处理');
    expect(toolDisplayCopy('delegate_assistant', 'ok')).not.toContain('完成');
  });
  it('uses only known semantic options outside the expanded details', () => {
    expect(toolDisplayCopy('list_cards', 'running', '{"state":"due","target":"card:private-id"}')).toBe('正在查看今天该复习的卡片…');
    expect(toolDisplayCopy('propose_card', 'running', '{"kind":"method"}')).toBe('正在准备收录锦囊…');
    expect(toolDisplayCopy('unknown_private_tool', 'error', '{"path":"/private/internal"}')).toBe('这次没能处理这一步');
  });
  it('keeps complete and unfinished arguments readable without changing their values', () => {
    const raw = '{"question":"先看哪一步？","locator":{"page":3}}';
    expect(JSON.parse(prettyToolArguments(raw))).toEqual(JSON.parse(raw));
    expect(prettyToolArguments('{"partial":')).toBe('{"partial":');
  });
});
