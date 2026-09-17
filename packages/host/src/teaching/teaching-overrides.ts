import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import { TeachingOverrideSchema, type TeachingNode, type TeachingResource } from '@studyforge/contracts/teaching';
import type { RecordStore } from '@studyforge/domain/storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeachingCatalog } from './teaching-context.ts';
import { TASK_SKILLS } from './task-skills.ts';
import { ROLES, type DelegationRole } from './native-delegation.ts';
import { activeArtifacts, installedBody } from '../creation/artifact-service.ts';

declare module '@deepseek-ai/cordis' {
  interface Context { studyforgeTeachingOverrides: RecordStore<typeof TeachingOverrideSchema>; }
}

const workspace = (host: Context): HostContext => ({ workspaceId: host.studyforgeAccess.workspaceId, actor: 'student', purpose: 'learning' });

interface BundledNode {
  readonly id: string;
  readonly title: string;
  readonly kind: 'base' | 'guided' | 'preset' | 'skill' | 'assistant';
  readonly bundled: string;
}

/** The bundled teaching texts, addressed by stable node ids. */
export function bundledNodes(host: Context): BundledNode[] {
  const catalog = host.studyforgeTeachingCatalog;
  return [
    { id: 'base', title: '共同规则', kind: 'base', bundled: catalog.base },
    { id: 'guided', title: '诊断与路线引导', kind: 'guided', bundled: catalog.guided },
    ...catalog.choices.map(choice => ({ id: 'preset/' + choice.id, title: choice.title, kind: 'preset' as const, bundled: catalog.body(choice.id) })),
    ...TASK_SKILLS.map(skill => ({ id: 'skill/' + skill.id, title: skill.title, kind: 'skill' as const,
      bundled: readFileSync(join(catalog.directory, 'skills', skill.id + '.md'), 'utf8') })),
    ...(Object.keys(ROLES) as DelegationRole[]).map(role => ({ id: 'assistant/' + role, title: ROLES[role].title, kind: 'assistant' as const,
      bundled: readFileSync(join(catalog.directory, 'assistants', role + '.md'), 'utf8') })),
  ];
}

/** Record id under the `teaching:` kind; nodeIds keep `/` in their public form. */
export function overrideRef(nodeId: string): string {
  return 'teaching:' + nodeId.replaceAll('/', '_');
}

export function overrideRow(host: Context, nodeId: string): { ref: string; version: number; body: string } | undefined {
  // A harness host without the collection simply has no overrides to apply.
  const store = host.studyforgeTeachingOverrides as RecordStore<typeof TeachingOverrideSchema> | undefined;
  const row = store?.list(workspace(host)).find(item => item.data.nodeId === nodeId);
  return row === undefined ? undefined : { ref: row.ref, version: row.version, body: row.data.body };
}

/** The text prompt assembly and invocation actually use. */
export function teachingText(host: Context, nodeId: string, bundled: string): string {
  return overrideRow(host, nodeId)?.body ?? bundled;
}

/** The whole teaching tree: bundled nodes plus installed teaching artifacts. */
export function teachingResources(host: Context): TeachingNode[] {
  const rows = new Map((host.studyforgeTeachingOverrides?.list(workspace(host)) ?? []).map(row => [row.data.nodeId, row.data.body] as const));
  const bundled = bundledNodes(host).map(node => ({ id: node.id, title: node.title, kind: node.kind, origin: 'bundled' as const,
    overridden: rows.get(node.id) !== undefined && rows.get(node.id) !== node.bundled, editable: true }));
  const artifacts = activeArtifacts(host).filter(item => item.manifest.kind === 'teaching').map(item => ({
    id: 'artifact/' + item.ref + '@' + item.digest, title: item.manifest.title, kind: 'artifact' as const,
    origin: (item.ref.startsWith('plugin:') ? 'plugin' : 'creation') as 'plugin' | 'creation', overridden: false, editable: false,
  }));
  return [...bundled, ...artifacts];
}

/** One node's full read: effective body plus the bundled baseline when it exists. */
export function teachingResource(host: Context, nodeId: string): TeachingResource {
  const bundled = bundledNodes(host).find(node => node.id === nodeId);
  if (bundled) {
    const row = overrideRow(host, nodeId);
    return { id: bundled.id, title: bundled.title, kind: bundled.kind, origin: 'bundled',
      overridden: row !== undefined && row.body !== bundled.bundled, editable: true,
      body: row?.body ?? bundled.bundled, bundledBody: bundled.bundled, version: row?.version ?? null };
  }
  if (nodeId.startsWith('artifact/')) {
    const [ref, digest] = nodeId.slice('artifact/'.length).split('@');
    const installed = activeArtifacts(host).find(item => item.ref === ref && item.digest === digest);
    if (!installed) throw new Error('teaching_node_missing');
    const resource = installedBody(host, installed.ref, installed.digest);
    return { id: nodeId, title: resource.manifest.title, kind: 'artifact',
      origin: installed.ref.startsWith('plugin:') ? 'plugin' : 'creation', overridden: false, editable: false,
      body: resource.body, bundledBody: null, version: null };
  }
  throw new Error('teaching_node_missing');
}

/** Student-authored write of one override; CAS on the existing row. */
export async function saveTeachingOverride(host: Context, input: { nodeId: string; body: string; expectedVersion: number; operationId: string }): Promise<TeachingResource> {
  if (!bundledNodes(host).some(node => node.id === input.nodeId)) throw new Error('teaching_node_not_editable');
  const current = overrideRow(host, input.nodeId);
  const context = { ...workspace(host), operationId: input.operationId, expectedVersion: input.expectedVersion };
  if ((current?.version ?? 0) !== input.expectedVersion) throw new Error('version_conflict');
  if (current) await host.studyforgeTeachingOverrides.update(context, current.ref, { nodeId: input.nodeId, body: input.body }, () => ({ nodeId: input.nodeId, body: input.body }));
  else await host.studyforgeTeachingOverrides.create(context, input.nodeId.replaceAll('/', '_'), { nodeId: input.nodeId, body: input.body });
  return teachingResource(host, input.nodeId);
}

/** Write the bundled body back into the override: a recorded version, not a delete. */
export async function resetTeachingOverride(host: Context, input: { nodeId: string; expectedVersion: number; operationId: string }): Promise<TeachingResource> {
  const bundled = bundledNodes(host).find(node => node.id === input.nodeId);
  const current = overrideRow(host, input.nodeId);
  if (!bundled || !current) throw new Error('record_missing');
  await host.studyforgeTeachingOverrides.update({ ...workspace(host), operationId: input.operationId, expectedVersion: input.expectedVersion },
    current.ref, { nodeId: input.nodeId, body: bundled.bundled }, () => ({ nodeId: input.nodeId, body: bundled.bundled }));
  return teachingResource(host, input.nodeId);
}
