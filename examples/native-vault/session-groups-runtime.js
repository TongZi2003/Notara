import { randomUUID } from 'node:crypto';
import { Service } from '@deepseek-ai/cordis';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';

const fail = code => { throw new Error(code); };
const idSchema = z.string().min(1).max(200).refine(value => !/[\x00-\x1f]/.test(value));
const titleSchema = z.string().trim().min(1).max(80).refine(value => !/[\x00-\x1f]/.test(value));
const groupSchema = z.object({ id: idSchema, title: titleSchema }).strict();
const memberSchema = z.object({ sessionId: idSchema, groupId: idSchema }).strict();
const recordSchema = z.object({ revision: z.number().int().nonnegative(), groups: z.array(groupSchema), members: z.array(memberSchema) }).strict().refine(value => {
  const ids = new Set(value.groups.map(group => group.id));
  return ids.size === value.groups.length && new Set(value.members.map(member => member.sessionId)).size === value.members.length && value.members.every(member => ids.has(member.groupId));
});
const patchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), title: titleSchema }).strict(),
  z.object({ kind: z.literal('rename'), groupId: idSchema, title: titleSchema }).strict(),
  z.object({ kind: z.literal('move'), sessionId: idSchema, groupId: idSchema.nullable() }).strict(),
  z.object({ kind: z.literal('dissolve'), groupId: idSchema }).strict(),
]);

/** List classification only: never a workspace, a teaching fact or a session event. */
export const sessionGroupsSpec = defineDomain({ name: 'notara_session_groups', version: 1, tables: { workspaces: domainTable(recordSchema) } });
const empty = () => ({ revision: 0, groups: [], members: [] });
const nameKey = value => value.normalize('NFKC').toLocaleLowerCase();

export class NotaraSessionGroups extends Service {
  static inject = ['storageDomain', 'workspaceRegistry'];
  constructor(ctx) {
    super(ctx, 'notaraSessionGroups');
    this.opening = null;
    this.tail = Promise.resolve();
    this.closed = false;
    ctx.effect(() => () => this.close(), 'notara-session-groups.close');
  }
  async domain() {
    if (this.closed) fail('session_groups_unavailable');
    this.opening ??= this.ctx.storageDomain.open(sessionGroupsSpec);
    try { return await this.opening; }
    catch (error) { this.opening = null; throw error; }
  }
  workspace(workspaceId) {
    if (!idSchema.safeParse(workspaceId).success) fail('session_groups_input_invalid');
    const workspace = this.ctx.workspaceRegistry.get(workspaceId);
    if (!workspace) fail('session_groups_workspace_missing');
    return workspace;
  }
  project(workspace, record) {
    const ids = new Set(workspace.sessionIds);
    return { workspaceId: workspace.id, revision: record.revision, groups: record.groups.map(group => ({ ...group })), members: record.members.filter(member => ids.has(member.sessionId)).map(member => ({ ...member })) };
  }
  async list({ workspaceId }) {
    const domain = await this.domain(), workspace = this.workspace(workspaceId);
    return this.project(workspace, domain.table('workspaces').get(workspace.id) ?? empty());
  }
  async mutate({ workspaceId, expectedRevision, patch }) {
    const parsed = patchSchema.safeParse(patch);
    if (!parsed.success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('session_groups_input_invalid');
    const work = this.tail.catch(() => {}).then(async () => {
      const domain = await this.domain(), workspace = this.workspace(workspaceId), table = domain.table('workspaces');
      const current = table.get(workspace.id) ?? empty(), action = parsed.data;
      if (current.revision !== expectedRevision) fail('session_groups_conflict');
      let groups = current.groups.map(group => ({ ...group }));
      let members = current.members.filter(member => workspace.sessionIds.includes(member.sessionId)).map(member => ({ ...member }));
      const target = groups.find(group => group.id === action.groupId);
      if (action.kind !== 'create' && action.groupId !== null && !target) fail('session_groups_group_missing');
      if (action.kind === 'create' || action.kind === 'rename') {
        if (groups.some(group => group.id !== action.groupId && nameKey(group.title) === nameKey(action.title))) fail('session_groups_name_duplicate');
        if (action.kind === 'create') groups.push({ id: randomUUID(), title: action.title });
        else target.title = action.title;
      } else if (action.kind === 'move') {
        // The registry already validates membership against the original canonical cwd.
        // No attach/detach, Session rename, events, board or memory APIs are called.
        if (!workspace.sessionIds.includes(action.sessionId)) fail('session_groups_session_missing');
        members = members.filter(member => member.sessionId !== action.sessionId);
        if (action.groupId !== null) members.push({ sessionId: action.sessionId, groupId: action.groupId });
      } else {
        groups = groups.filter(group => group.id !== action.groupId);
        members = members.filter(member => member.groupId !== action.groupId);
      }
      const next = { revision: current.revision + 1, groups, members };
      // A single record keeps folder changes and membership removal in one durable commit.
      await table.put(workspace.id, next);
      return this.project(workspace, next);
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async close() {
    this.closed = true;
    await this.tail;
    if (this.opening) await (await this.opening).close();
  }
}

export function installSessionGroups(ctx) { ctx.plugin(NotaraSessionGroups); }
