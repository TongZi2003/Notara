type Block = { readonly type: string; readonly text?: string };
/** Only actual skill-invocation names decorate user text; never rewrite ordinary mentions. */
export function displaySkillReferences<T extends Block>(content: readonly T[], loaded: readonly string[], labels: Readonly<Record<string, string>>): { content: T[]; titles: string[] } {
  const known = new Set(loaded.filter(name => labels[name] || /^(?:notara-[a-f0-9]{24}-[a-f0-9]{16}-|studyforge-user-)/.test(name)));
  const used = new Set<string>();
  const blocks = content.map(block => block.type !== 'text' || block.text === undefined ? block : { ...block, text: block.text.replace(/(^|\s)\/([\w-]+)(?=\s|$)/gu, (whole, space: string, name: string) => {
    if (!known.has(name)) return whole;
    used.add(name); return space;
  }).trimEnd() });
  return { content: blocks, titles: [...used].map(name => labels[name] ?? '已选学习技能') };
}
