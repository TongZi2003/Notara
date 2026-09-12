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
  it('describes the exact reading range and uses only the title of the successful frozen result', () => {
    const args = JSON.stringify({ source: { materialId: 'mat_private', locator: { kind: 'pdf', page: 3 } } });
    expect(toolDisplayCopy('read_material', 'ok', args, '{"title":"三角函数讲义","text":"不要把正文抄到摘要"}')).toBe('阅读“三角函数讲义”第 3 页：已完成');
    expect(toolDisplayCopy('read_material', 'error', args, '{"title":"错误回话不能当书名"}')).toBe('这次没能阅读原文第 3 页');
    expect(toolDisplayCopy('read_material', 'ok', '{"source":{"locator":{"kind":"text","start":{"line":12},"end":{"line":28}}}}')).toContain('第 12–28 行');
  });
  it('distinguishes directory replacement, additions, removals and renaming without claiming a save', () => {
    const nodes = ['甲', '乙', '丙', '丁'].map(title => ({ path: '和差公式/' + title }));
    expect(toolDisplayCopy('propose_skeleton', 'ok', JSON.stringify({ change: { nodes } }))).toBe('整理“和差公式”的 4 个小节：提案已准备好');
    expect(toolDisplayCopy('propose_skeleton', 'ok', JSON.stringify({ change: { nodes, replaceExisting: true, detachDependents: true } }))).toContain('重排整本目录（4 节）并解除受影响的关联');
    expect(toolDisplayCopy('propose_skeleton', 'ok', JSON.stringify({ change: { removePaths: ['甲'], repath: [{ from: '乙', to: '丙' }] } }))).toContain('删除 1 节、改名或移动 1 节');
  });
  it('keeps useful search and edit parameters, never raw identity, body or URL query data', () => {
    expect(toolDisplayCopy('search_learning', 'running', '{"query":"配角与凑角","target":"card:secret"}')).toBe('正在查找与“配角与凑角”有关的知识和资料…');
    expect(toolDisplayCopy('update_card', 'ok', '{"target":"card:secret","patch":{"front":"SECRET_BODY","tags":["条件"]}}', '{"content":{"title":"定义域"}}')).toBe('修改“定义域”的卡面、标签：已完成');
    expect(toolDisplayCopy('web_fetch', 'running', '{"url":"https://user:password@example.com/page?token=SECRET"}')).toBe('正在阅读 example.com 上的网页…');
  });
  it('describes explicit schedules without presenting the unused daily quota as its behavior', () => {
    expect(toolDisplayCopy('propose_plan', 'ok', JSON.stringify({ action: 'create', content: { kind: 'campaign', title: '期末复习', dailyCount: 9, schedule: [{ date: '2026-10-01', cards: [] }] } }))).toContain('安排“期末复习”的 1 项日程');
    expect(toolDisplayCopy('read_cards', 'running', '{"targets":["card:a","card:b"]}')).toBe('正在阅读选中的 2 张卡片…');
  });
});
