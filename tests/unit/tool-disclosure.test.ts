import { describe, expect, it } from 'vitest';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { ToolCallId, createToolResultMessage, type ToolSchema } from '@deepseek-ai/dsh-llm';
import { classroomToolCatalogue, projectClassroomTools, retainedTools, toolCatalogueText } from '../../packages/host/src/tools/tool-disclosure.ts';

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

describe('progressive classroom tool disclosure', () => {
  it('removes deferred parameter schemas while keeping a compact discoverable catalogue', () => {
    const tools = [tool('read_lesson'), tool('load_tools'), tool('read_route')];
    const shown = projectClassroomTools({ sections: [], contexts: [], variables: {}, tools }, tools, new Set());
    expect(shown.tools.map(row => row.name)).toEqual(['read_lesson', 'load_tools']);
    expect(shown.sections[0]?.text).toContain('read_route — 读取课程路线');
    expect(shown.sections[0]?.text).not.toContain('hidden_parameter');
    expect(toolCatalogueText([tool('read_route')])).not.toContain('完整说明不应');
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
