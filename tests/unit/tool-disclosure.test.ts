import { describe, expect, it } from 'vitest';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { ToolCallId, createToolResultMessage, type ToolSchema } from '@deepseek-ai/dsh-llm';
import { DEFAULT_CLASSROOM_FACADE_METHODS, TOOL_FACADES, resolveFacadeTool } from '@studyforge/contracts/tool-facades';
import { classroomToolCatalogue, retainedTools } from '../../packages/host/src/tools/tool-disclosure.ts';

const tool = (name: string): ToolSchema => ({ name, description: '读取课程路线。完整说明不应塞进简短目录。', parameters: { type: 'object', properties: { hidden_parameter: { type: 'string' } } } });
function call(session: Session, name: string, args: unknown = {}) {
  const id = ToolCallId(crypto.randomUUID());
  session.append('tool/call', { turn: 1, step: 1, callId: id, name, arguments: JSON.stringify(args) });
  return id;
}
function result(session: Session, id: ReturnType<typeof ToolCallId>, loaded: string[], isError = false) {
  session.append('tool/result', { turn: 1, step: 1,
    message: createToolResultMessage({ callId: id, content: [{ type: 'text', text: 'result' }], isError }),
    meta: { loaded, available: 'next_step', scope: 'current_lesson' },
  }, { surfaceOp: 'append' });
}

describe('constant classroom tool surface', () => {
  it('resolves facade calls to the wrapped tool, from objects and raw JSON', () => {
    expect(resolveFacadeTool('propose', { method: 'route', input: { action: 'add' } })).toBe('propose_route');
    expect(resolveFacadeTool('open', JSON.stringify({ method: 'skeleton', input: {} }))).toBe('read_skeleton');
    expect(resolveFacadeTool('read_material', {})).toBeUndefined();
    expect(resolveFacadeTool('propose', { method: 'nope' })).toBeUndefined();
    expect(resolveFacadeTool('open', 'not json')).toBeUndefined();
    expect(resolveFacadeTool('open', {})).toBeUndefined();
  });
  it('keeps every wrapped tool name unique across facades', () => {
    const inner = Object.values(TOOL_FACADES).flatMap(methods => Object.values(methods));
    expect(new Set(inner).size).toBe(inner.length);
  });
  it('keeps the default classroom surface focused on core learning capabilities', () => {
    expect(DEFAULT_CLASSROOM_FACADE_METHODS).not.toHaveProperty('board');
    expect(DEFAULT_CLASSROOM_FACADE_METHODS).not.toHaveProperty('round');
    expect(DEFAULT_CLASSROOM_FACADE_METHODS.delegate).not.toContain('problem');
    expect(DEFAULT_CLASSROOM_FACADE_METHODS.find).toContain('plans');
    expect(DEFAULT_CLASSROOM_FACADE_METHODS.open).toContain('route');
    expect(DEFAULT_CLASSROOM_FACADE_METHODS.stage).toContain('read');
    const methods = Object.entries(DEFAULT_CLASSROOM_FACADE_METHODS).flatMap(([facade, names]) => names.map(name => `${facade}:${name}`));
    expect(new Set(methods).size).toBe(methods.length);
  });
  it('only accepts completed native loader results, not arguments, failed results or unmatched metadata', () => {
    const session = Session.create(SessionId('load-test'));
    const id = call(session, 'load_tools', { names: ['propose_route'] });
    expect(retainedTools(session.snapshotEvents()).has('propose_route')).toBe(false);
    result(session, id, ['propose_route'], true);
    expect(retainedTools(session.snapshotEvents()).has('propose_route')).toBe(false);
    result(session, ToolCallId('unmatched'), ['write']);
    expect(retainedTools(session.snapshotEvents()).has('write')).toBe(false);
    result(session, call(session, 'load_tools'), ['read_route', 'propose_route']);
    result(session, call(session, 'load_tools'), ['read_route', 'read_plan']);
    expect([...retainedTools(session.snapshotEvents())].sort()).toEqual(['propose_route', 'read_plan', 'read_route']);
  });
  it('retains actual pre-upgrade calls and native task controls without inheriting another lesson', () => {
    const session = Session.create(SessionId('prior-calls'));
    call(session, 'delegate_search');
    const inheritedEnd = session.snapshotEvents().length;
    call(session, 'read_lesson');
    expect([...retainedTools(session.snapshotEvents())]).toEqual(expect.arrayContaining(['delegate_search', 'send_message', 'interrupt_agent']));
    expect([...retainedTools(session.snapshotEvents().slice(inheritedEnd))]).toEqual(['read_lesson']);
  });
  it('loading never advertises classroom writes or widens diagnostic registration', () => {
    const tools = ['write', 'edit', 'run_code', 'register_cards', 'propose_card'].map(tool);
    expect(classroomToolCatalogue(tools, false).map(row => row.name)).toEqual(['propose_card']);
    expect(classroomToolCatalogue(tools, true).map(row => row.name)).toEqual(['register_cards', 'propose_card']);
  });
});
