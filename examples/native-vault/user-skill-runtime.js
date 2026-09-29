import { basename } from 'node:path';
import { OVERVIEW_TEMPLATE, globalSkillRoot, inheritUserSkill, readUserSkills, resolveSkillRevision, saveUserSkill, setSkillRoot, setUserSkillStatus } from './user-skills.js';

const fail = code => { throw new Error(code); };

/**
 * The student's side of the two skill tiers, for the settings page: what
 * exists in every registered learning set and in the shared tier, and the only
 * three decisions a student makes — turn a skill on or off, adopt or discard a
 * pending revision, inherit a skill from another learning set.
 */
export function createUserSkillRuntime(service, { env = process.env } = {}) {
  const workspaces = () => service.ctx.get('workspaceRegistry')?.list() ?? [];
  const workspace = id => workspaces().find(row => row.id === id) ?? fail('vault_scope_unavailable');
  const title = row => row.title || basename(row.path);
  const rootFor = ({ scope, workspaceId }) => {
    if (scope === 'global') return globalSkillRoot(env) ?? fail('skill_scope_unavailable');
    if (scope === 'set') return setSkillRoot(workspace(workspaceId).path);
    return fail('skill_scope_invalid');
  };
  async function list() {
    const shared = globalSkillRoot(env);
    return {
      global: shared ? { skills: await readUserSkills(shared, 'global') } : null,
      sets: await Promise.all(workspaces().map(async row => ({ workspaceId: row.id, title: title(row), skills: await readUserSkills(setSkillRoot(row.path), 'set') }))),
    };
  }
  return {
    list,
    async setStatus({ scope, workspaceId, id, status, expectedRevision }) {
      await setUserSkillStatus(rootFor({ scope, workspaceId }), { id, status, expectedRevision });
      return list();
    },
    async resolveRevision({ scope, workspaceId, id, action, expectedRevision }) {
      await resolveSkillRevision(rootFor({ scope, workspaceId }), { id, action, expectedRevision });
      return list();
    },
    async createOverview({ workspaceId }) {
      try { await saveUserSkill(setSkillRoot(workspace(workspaceId).path), { content: OVERVIEW_TEMPLATE }); }
      catch (error) { if (error.message === 'skill_revision_required') fail('overview_exists'); throw error; }
      return list();
    },
    async inherit({ fromWorkspaceId, toWorkspaceId, id }) {
      if (fromWorkspaceId === toWorkspaceId) fail('skill_inherit_same_set');
      const from = workspace(fromWorkspaceId), to = workspace(toWorkspaceId);
      await inheritUserSkill(setSkillRoot(from.path), setSkillRoot(to.path), { id, from: title(from) });
      return list();
    },
  };
}
