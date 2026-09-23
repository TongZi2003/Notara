import { createHash } from 'node:crypto';

const ORIGINAL_SHA = 'c92854f3e75a542cea0e3d9c3f4e82a5c4c6c008f25c053c65d52df554d7d63c';
const CANDIDATES = 'return (0, _deepseek_ai_dsh_client_ui_primitives.rankByName)(skills, query).map((skill) => ({\n\t\t\t\t\t\tname: skill.name,\n\t\t\t\t\t\tdescription: skill.modelInvocable ? skill.description : `${t("menu.userOnly")} · ${skill.description}`\n\t\t\t\t\t}));';
const PICK = 'return { text: `/${candidate.name} ` };';
const PICK_WITH_VALUE = 'return { text: `${position === "inline" ? " " : ""}/${candidate.value ?? candidate.name} ` };';
const SIGNATURE = 'onPick({ candidate }) {';
const BLOCK = /\/\* notara:skill-menu:start \*\/[\s\S]*?\/\* notara:skill-menu:end \*\//;
const PICK_BLOCK = /\/\* notara:skill-pick:start \*\/[\s\S]*?\/\* notara:skill-pick:end \*\//;
const STATE = 'const expandedSkills = new Set();\n\t\t\tconst source = {';
const WITH_SESSION = 'onPick({ candidate, position, session }) {';

/** Display metadata only: native Skill names, scope and invocation stay intact. */
export function patchSkillMenu(source: string, titles: Record<string, string>, more: readonly string[] = []): string {
  const base = source.replace(BLOCK, CANDIDATES).replace(PICK_BLOCK, PICK)
    .replace(WITH_SESSION, SIGNATURE).replace(STATE, 'const source = {');
  if (createHash('sha256').update(base).digest('hex') !== ORIGINAL_SHA) throw new Error('Unknown rc.2 Skill menu module; review the patch');
  const body = `/* notara:skill-menu:start */
                    const labels = ${JSON.stringify(titles)};
                    const more = new Set(${JSON.stringify(more)});
                    const label = name => Object.hasOwn(labels, name) ? labels[name] : name;
                    const ranked = (0, _deepseek_ai_dsh_client_ui_primitives.rankByName)(skills, query);
                    const names = new Set(ranked.map(skill => skill.name));
                    const term = query.trim().toLocaleLowerCase();
                    const matches = term ? skills.filter(skill => !names.has(skill.name) &&
                      [label(skill.name), skill.description].some(text => text.toLocaleLowerCase().includes(term))) : [];
                    const expanded = expandedSkills.has(session.sessionId);
                    const items = [...ranked, ...matches].filter(skill => term || expanded || !more.has(skill.name)).map(skill => ({
                      name: label(skill.name),
                      value: skill.name,
                      description: skill.modelInvocable ? skill.description : \`\${t("menu.userOnly")} · \${skill.description}\`
                    }));
                    const count = skills.filter(skill => more.has(skill.name)).length;
                    if (!term && count) items.push({
                      name: expanded ? "收起更多技能" : "更多技能",
                      description: expanded ? "仅显示常用功能" : count + " 项 · 教学方法、学科关注与辅助工作流",
                      value: "notara:toggle-more"
                    });
                    return items;
                    /* notara:skill-menu:end */`;
  const pick = `/* notara:skill-pick:start */
                    if (candidate.value === "notara:toggle-more") {
                      if (expandedSkills.has(session.sessionId)) expandedSkills.delete(session.sessionId);
                      else expandedSkills.add(session.sessionId);
                      return { refresh: true };
                    }
                    expandedSkills.delete(session.sessionId);
                    ${PICK_WITH_VALUE}
                    /* notara:skill-pick:end */`;
  return base.replace(CANDIDATES, () => body).replace(PICK, () => pick).replace(SIGNATURE, WITH_SESSION).replace('const source = {', STATE);
}
