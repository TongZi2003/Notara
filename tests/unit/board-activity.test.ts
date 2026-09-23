import { expect, test } from 'vitest';
import { summarizeDocumentChange, summarizeWorldbookChange } from '../../packages/host/src/plugins/board-activity.ts';
import { resolveFacadeTool, TOOL_FACADES } from '../../packages/contracts/src/tool-facades.ts';
import { WorkbenchActivityEntrySchema } from '../../packages/contracts/src/plugins.ts';
import type { PluginDocument } from '../../packages/contracts/src/plugin-learning.ts';

const scene = (patch: Record<string, unknown> = {}): PluginDocument => ({
  kind: 'math', title: '数学探索', viewport: [-5, 5, 5, -5],
  space: { bounds: [[-5, 5], [-5, 5], [-5, 5]], azimuth: .8, elevation: .35 },
  view: '2d', parameters: [], objects: [], observation: '', links: [], ...patch,
} as PluginDocument);

test('math document diffs name the moved object, added and removed objects', () => {
  const before = scene({ objects: [
    { kind: 'point', name: 'A', x: 0, y: 0, draggable: true, color: 'accent', visible: true },
    { kind: 'point', name: 'B', x: 1, y: 1, draggable: true, color: 'accent', visible: true },
  ] });
  const moved = scene({ objects: [
    { kind: 'point', name: 'A', x: 2, y: 3, draggable: true, color: 'accent', visible: true },
    { kind: 'point', name: 'B', x: 1, y: 1, draggable: true, color: 'accent', visible: true },
  ] });
  expect(summarizeDocumentChange(before, moved)).toContain('A 移到 (2, 3)');
  const added = scene({ objects: [...(before as { objects: unknown[] }).objects, { kind: 'circle', name: 'c', center: 'A', radius: 2, visible: true }] });
  expect(summarizeDocumentChange(before, added)).toContain('新增圆 c');
  expect(summarizeDocumentChange(added, before)).toContain('删除 c');
});

test('math document diffs cover parameters, viewport, camera and observation', () => {
  const base = scene({ parameters: [{ name: 'a', value: 1, min: -2, max: 2 }] });
  expect(summarizeDocumentChange(base, scene({ parameters: [{ name: 'a', value: 2.5, min: -2, max: 2 }] }))).toContain('参数 a：1 → 2.5');
  expect(summarizeDocumentChange(base, scene({ ...base, parameters: [{ name: 'a', value: 1, min: -2, max: 2 }, { name: 'b', value: 0, min: -1, max: 1 }] }))).toContain('新增参数 b=0');
  expect(summarizeDocumentChange(base, scene({ ...base, viewport: [-2, 8, 6, -4] }))).toContain('调整视区');
  expect(summarizeDocumentChange(base, scene({ ...base, view: '3d' }))).toContain('切换到三维视图');
  const turned = scene({ ...base, space: { bounds: [[-5, 5], [-5, 5], [-5, 5]], azimuth: 1.2, elevation: .35 } });
  expect(summarizeDocumentChange(base, turned)).toContain('旋转三维视角');
  expect(summarizeDocumentChange(base, scene({ ...base, observation: '发现了对称' }))).toContain('更新观察笔记');
  expect(summarizeDocumentChange(base, base)).toBe('内容未变');
});

test('non-math documents fall back to field-level diffs with Chinese labels', () => {
  const board = (blocks: unknown[]) => ({ kind: 'blackboard', title: '板书', blocks, links: [] }) as unknown as PluginDocument;
  const before = board([{ title: '引入', text: 'a' }]);
  const after = board([{ title: '引入', text: 'a' }, { title: '例题', text: 'b' }]);
  expect(summarizeDocumentChange(before, after)).toContain('板书块');
  expect(summarizeDocumentChange(before, after)).toContain('+例题');
  expect(summarizeDocumentChange(before, before)).toBe('内容未变');
});

test('worldbook diffs report entry counts without disclosing gated titles or bodies', () => {
  const book = (entries: unknown[]) => ({ entries });
  const text = summarizeWorldbookChange(book([{ title: '角色', body: 'x' }]) as never, book([{ title: '角色', body: 'x' }, { title: '新条目', body: 'y' }]) as never);
  expect(text).toBe('条目 +1');
  expect(text).not.toContain('新条目');
  expect(text).not.toContain('角色');
  expect(summarizeWorldbookChange(book([{ title: '秘密', body: '旧内容' }]) as never, book([{ title: '秘密', body: '新内容' }]) as never)).toBe('修改条目');
  expect(summarizeWorldbookChange(book([{ title: '秘密', body: '内容' }]) as never, book([]) as never)).toBe('条目 -1');
});

test('activity entries accept optional revision/labels and cap label count', () => {
  const parsed = WorkbenchActivityEntrySchema.parse({ at: '2026-09-17T10:00:00Z', actor: 'student', kind: 'document', revision: 3, labels: ['移动 A'], detail: 'A 移到 (2, 3)' });
  expect(parsed).toMatchObject({ actor: 'student', kind: 'document', revision: 3 });
  expect(WorkbenchActivityEntrySchema.safeParse({ at: '2026-09-17T10:00:00Z', actor: 'student', kind: 'note' }).success).toBe(true);
  expect(WorkbenchActivityEntrySchema.safeParse({ at: 'x', actor: 'student', kind: 'note' }).success).toBe(false);
  expect(WorkbenchActivityEntrySchema.safeParse({ at: '2026-09-17T10:00:00Z', actor: 'nobody', kind: 'note' }).success).toBe(false);
  expect(WorkbenchActivityEntrySchema.safeParse({ at: '2026-09-17T10:00:00Z', actor: 'student', kind: 'document', labels: Array(9).fill('l') }).success).toBe(false);
});

test('board facade resolves the activity method to read_workbench_activity', () => {
  expect(TOOL_FACADES.board.activity).toBe('read_workbench_activity');
  expect(resolveFacadeTool('board', { method: 'activity', input: { id: 'x' } })).toBe('read_workbench_activity');
  expect(resolveFacadeTool('board', '{"method":"activity","input":{"id":"x"}}')).toBe('read_workbench_activity');
  expect(resolveFacadeTool('board', { method: 'nonsense' })).toBeUndefined();
});
