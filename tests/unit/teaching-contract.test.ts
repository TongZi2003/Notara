import { describe, expect, test } from 'vitest';
import { TeachingNodeSchema, TeachingOverrideSchema, TeachingResourceSchema } from '../../packages/contracts/src/teaching.ts';
import { ProposalItemInputSchema, effectTargetProblem } from '../../packages/contracts/src/proposals.ts';

describe('TeachingOverride', () => {
  test('accepts a node id plus a non-empty body and nothing else', () => {
    expect(TeachingOverrideSchema.parse({ nodeId: 'preset/socratic', body: '改写后的教法正文' })).toEqual({ nodeId: 'preset/socratic', body: '改写后的教法正文' });
    expect(TeachingOverrideSchema.safeParse({ nodeId: '', body: 'x' }).success).toBe(false);
    expect(TeachingOverrideSchema.safeParse({ nodeId: 'base', body: '' }).success).toBe(false);
    expect(TeachingOverrideSchema.safeParse({ nodeId: 'base', body: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('TeachingNode and TeachingResource', () => {
  const node = { id: 'preset/socratic', title: '苏格拉底授课', kind: 'preset', origin: 'bundled', overridden: false, editable: true };
  test('a tree row names its kind, origin and override state', () => {
    expect(TeachingNodeSchema.parse(node)).toEqual(node);
    expect(TeachingNodeSchema.safeParse({ ...node, kind: 'other' }).success).toBe(false);
    expect(TeachingNodeSchema.safeParse({ ...node, origin: 'unknown' }).success).toBe(false);
  });
  test('a resource adds the effective body, the bundled baseline and the override revision', () => {
    const bundled = { ...node, body: '生效正文', bundledBody: '内置原文', version: null };
    const edited = { ...node, overridden: true, body: '覆盖正文', bundledBody: '内置原文', version: 3 };
    const artifact = { ...node, kind: 'artifact', origin: 'creation', editable: false, body: '作品正文', bundledBody: null, version: null };
    expect(TeachingResourceSchema.parse(bundled)).toEqual(bundled);
    expect(TeachingResourceSchema.parse(edited)).toEqual(edited);
    expect(TeachingResourceSchema.parse(artifact)).toEqual(artifact);
    expect(TeachingResourceSchema.safeParse({ ...edited, version: 0 }).success).toBe(false);
  });
});

describe('teaching-override proposal item', () => {
  const effect = { kind: 'teaching-override' as const, nodeId: 'base', title: '共同规则', body: '老师起草的新正文' };
  test('is an edit: it must carry the frozen target and baseline', () => {
    expect(effectTargetProblem(effect, null, null)).toContain('必须带上');
    expect(effectTargetProblem(effect, 'teaching:base', 0)).toBeNull();
    expect(ProposalItemInputSchema.parse({ effect, target: 'teaching:base', baseline: 0 })).toMatchObject({ target: 'teaching:base', baseline: 0 });
  });
});
