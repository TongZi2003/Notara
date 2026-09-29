import { createHash } from 'node:crypto';

const ORIGINAL_SHA = 'c48f92f499d5af2dc93812fcebbc76569658d3a48dba9de662857a5ef4ef9283';
const CANDIDATES = 'return (0, _deepseek_ai_dsh_client_ui_primitives.rankByName)(skills, query).map((skill) => ({\n\t\t\t\t\t\tname: skill.name,\n\t\t\t\t\t\tdescription: skill.modelInvocable ? skill.description : `${t("menu.userOnly")} · ${skill.description}`\n\t\t\t\t\t}));';
const PICK = 'return { text: `/${candidate.name} ` };';
const PICK_WITH_VALUE = 'return { text: `${position === "inline" ? " " : ""}/${candidate.value ?? candidate.name} ` };';
const SIGNATURE = 'onPick({ candidate }) {';
const BLOCK = /\/\* notara:skill-menu:start \*\/[\s\S]*?\/\* notara:skill-menu:end \*\//;
const PICK_BLOCK = /\/\* notara:skill-pick:start \*\/[\s\S]*?\/\* notara:skill-pick:end \*\//;
const STATE = 'const expandedSkills = new Set();\n\t\t\tconst source = {';
const WITH_SESSION = 'onPick({ candidate, position, session }) {';
const RESET = 'ctx.on("connection/reset", clearAll);';
const REFRESH_BLOCK = /\n\t*\/\* notara:skill-refresh:start \*\/[\s\S]*?\/\* notara:skill-refresh:end \*\//;
/** The page announces a changed skill catalog (a skill turned on or off) so the menu re-lists it. */
const REFRESH = `
\t\t\t/* notara:skill-refresh:start */
\t\t\tctx.effect(() => {
\t\t\t\tconst refresh = () => clearAll();
\t\t\t\tglobalThis.addEventListener?.("notara:skills-changed", refresh);
\t\t\t\treturn () => globalThis.removeEventListener?.("notara:skills-changed", refresh);
\t\t\t});
\t\t\t/* notara:skill-refresh:end */`;

/** Display metadata only: native Skill names, scope and invocation stay intact. */
export function patchSkillMenu(source: string, titles: Record<string, string>, more: readonly string[] = []): string {
  const base = source.replace(BLOCK, CANDIDATES).replace(PICK_BLOCK, PICK)
    .replace(WITH_SESSION, SIGNATURE).replace(STATE, 'const source = {').replace(REFRESH_BLOCK, '');
  if (createHash('sha256').update(base).digest('hex') !== ORIGINAL_SHA) throw new Error('Unknown DSH Skill menu module; review the patch');
  const body = `/* notara:skill-menu:start */
                    const labels = ${JSON.stringify(titles)};
                    const more = new Set(${JSON.stringify(more)});
                    // A skill the student adopted names itself before the full-width colon of its description.
                    const label = (name, description = "") => Object.hasOwn(labels, name) ? labels[name]
                      : /^notara-(set|global)-/.test(name) && description.includes("：") ? description.slice(0, description.indexOf("：")) : name;
                    const ranked = (0, _deepseek_ai_dsh_client_ui_primitives.rankByName)(skills, query);
                    const names = new Set(ranked.map(skill => skill.name));
                    const term = query.trim().toLocaleLowerCase();
                    const matches = term ? skills.filter(skill => !names.has(skill.name) &&
                      [label(skill.name, skill.description), skill.description].some(text => text.toLocaleLowerCase().includes(term))) : [];
                    const expanded = expandedSkills.has(session.sessionId);
                    const items = [...ranked, ...matches].filter(skill => term || expanded || !more.has(skill.name)).map(skill => ({
                      name: label(skill.name, skill.description),
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
  return base.replace(CANDIDATES, () => body).replace(PICK, () => pick).replace(SIGNATURE, WITH_SESSION).replace('const source = {', STATE)
    .replace(RESET, () => RESET + REFRESH);
}
