import manifest from '../../resources/vault-teaching/manifest.json' with { type: 'json' };

/**
 * The native Skill row prints the skill's id (`notara-board`). A student reads
 * the teacher loading 板书 instead: built-in skills by their menu titles from the
 * teaching manifest, the student's own skills by their layer.
 */
const TITLES = new Map([...manifest.choices, ...manifest.skills].map(item => [`notara-${item.id}`, item.title]));
for (const [alias, canonical] of Object.entries({
  socratic: 'mixed', feynman: 'mixed', lecture: 'mixed', structural: 'mixed',
  brainstorm: 'consolidation', 'markdown-handout': 'material-outline', 'route-planning': 'lesson-preparation',
})) {
  const target = [...manifest.choices, ...manifest.skills].find(item => item.id === canonical);
  if (target) TITLES.set(`notara-${alias}`, target.title);
}

export function skillTitle(name) {
  if (typeof name !== 'string') return '教学技能';
  if (TITLES.has(name)) return TITLES.get(name);
  if (name.startsWith('notara-set-')) return '学习集里的技能';
  if (name.startsWith('notara-global-')) return '学科技能';
  return '教学技能';
}

/** The row for one Skill call: `{argsRaw}` while live, `{kind: 'tool-result', call}` once settled. */
export function skillRowText(block) {
  const raw = block?.argsRaw ?? block?.call?.argsRaw;
  let name;
  try { name = JSON.parse(raw)?.name; } catch { name = undefined; }
  if (block?.kind === 'tool-result' && block.isError) return `没有读到技能：${skillTitle(name)}`;
  return `读取技能：${skillTitle(name)}`;
}
