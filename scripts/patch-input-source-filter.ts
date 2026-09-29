import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Native Vault's 指令 launcher: the command menu also lists the available
// Skills, a pick may ask to refresh the open menu instead of inserting text
// (the 更多技能 toggle), and Enter/Tab stay in the menu while it is open.
// The source-filter seam the retired workbench needed was dropped with DSH 0.2.0.
const patches = [
  { path: 'lib/client.js', sha: '8fb600a9355c48edd02a54587efda18c70fe4047f5c9d124b1837a4214b1bd26', pairs: [
    // The toolbar launcher shares the slash catalog's user-visible Skill source.
    ['Toggle a menu containing exactly one registered source.', 'Toggle a source menu; the command launcher also includes available Skills.'],
    ['const match = this.deps.roster.sources(hit.trigger).find((item) => item.name === source);', 'const available = this.deps.roster.sources(hit.trigger);\n\t\t\t\tconst match = available.find((item) => item.name === source);'],
    ['this.menu.set(seedGroups(this.menu.getSnapshot(), [match]));', 'const sources = source === "command" ? available.filter(item => item.name === "command" || item.name === "skill") : [match];\n\t\t\t\tthis.menu.set(seedGroups(this.menu.getSnapshot(), sources));'],
    ['this.refreshHeaders(hit, [match]);', 'this.refreshHeaders(hit, sources);'],
    ['this.fetchCandidates(hit, [match]);', 'this.fetchCandidates(hit, sources);'],
    ['filter((source) => launched === null || source.name === launched);', 'filter((source) => launched === null || source.name === launched || (launched === "command" && source.name === "skill"));'],
    // Menu-only disclosure: no composer edits, submit events or hidden picks.
    ['span: hit.span\n\t\t\t\t});\n\t\t\t\tthis.stopFetch();', 'span: hit.span\n\t\t\t\t});\n\t\t\t\tif (outcome && typeof outcome === "object" && "refresh" in outcome) {\n\t\t\t\t\tthis.refreshOpenMenu();\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tthis.stopFetch();'],
    ['return "pick-highlighted";\n\t\t\t\t\t}\n\t\t\t\t\tcase "tab":', 'return this.menu.getSnapshot().open ? "consumed" : "pick-highlighted";\n\t\t\t\t\t}\n\t\t\t\t\tcase "tab":'],
    ['return "pick-highlighted";\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}', 'return this.menu.getSnapshot().open ? "consumed" : "pick-highlighted";\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}'],
  ] },
  { path: 'lib/types/types.d.ts', sha: '2f946769f9333a9193a5078529d6c415488c738c80b72552b06daeca32e79695', pairs: [['    onPick(pick: InputTriggerPick): PickOutcome;', '    /** Refresh menu candidates after a disclosure, without changing or submitting the draft. */\n    onPick(pick: InputTriggerPick): PickOutcome | { readonly refresh: true };']] },
] as const;
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
for (const patch of patches) {
  const path = new URL('../node_modules/@deepseek-ai/dsh-client-ui-input-trigger/' + patch.path, import.meta.url), source = readFileSync(path, 'utf8');
  let base = source;
  if (sha(base) !== patch.sha) {
    for (const [before, after] of [...patch.pairs].reverse()) base = base.replace(after, before);
    if (sha(base) !== patch.sha) throw new Error('Unknown DSH input-trigger artifact; review the command launcher patch');
  }
  // Reapply to the verified base so an older subset of these seams upgrades
  // instead of being mistaken for an already complete patch.
  let result = base;
  for (const [before, after] of patch.pairs) { if (result.split(before).length !== 2) throw new Error('Input source filter anchor changed'); result = result.replace(before, after); }
  if (result !== source) writeFileSync(path, result);
}
