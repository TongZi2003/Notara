import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Filter the source roster before menu reduction, keyboard picks and lexicon
// projection. A view-only filter would leave invisible keyboard choices.
const declaration = '    /** Reversible source availability policy; applied before menu and keyboard routing. */\n    registerSourceFilter(filter: (sessionId: string, source: Pick<InputTriggerSource, "trigger" | "name">) => boolean): () => void;\n';
const patches = [
  { path: 'lib/client.js', sha: '7c78c0e3dd4d63656ca1b523ef76e93942a8c8e925eec0fb5c95932693ab933c', pairs: [
    ['sources: [],\n\t\t\t\tcontrollers:', 'sources: [],\n\t\t\t\tfilters: new Set(),\n\t\t\t\tcontrollers:'],
    ['\t\t\tregisterSource(src) {', '\t\t\tregisterSourceFilter(filter) {\n\t\t\t\tconst live = this.live;\n\t\t\t\tconst sync = () => {\n\t\t\t\t\tfor (const [id, controller] of live.controllers) {\n\t\t\t\t\t\tcontroller.dismiss();\n\t\t\t\t\t\tfor (const source of live.sources) controller.sourceRemoved(source);\n\t\t\t\t\t\tfor (const source of live.sources) if ([...live.filters].every(rule => rule(id, source))) controller.sourceAdded(source);\n\t\t\t\t\t}\n\t\t\t\t};\n\t\t\t\tlive.filters.add(filter); sync();\n\t\t\t\treturn () => { live.filters.delete(filter); sync(); };\n\t\t\t}\n\t\t\tregisterSource(src) {'],
    ['for (const controller of live.controllers.values()) try {\n\t\t\t\t\tcontroller.sourceAdded(src);', 'for (const [id, controller] of live.controllers) try {\n\t\t\t\t\tif ([...live.filters].every(rule => rule(id, src))) controller.sourceAdded(src);'],
    ['sources: (trigger) => live.sources.filter((s) => s.trigger === trigger).sort', 'sources: (trigger) => live.sources.filter((s) => s.trigger === trigger && [...live.filters].every(rule => rule(id, s))).sort'],
    ['all: () => live.sources\n', 'all: () => live.sources.filter(source => [...live.filters].every(rule => rule(id, source)))\n'],
    // The toolbar launcher shares the slash catalog's user-visible Skill
    // source. It still honors scoped source filters before menu/keyboard picks.
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
  { path: 'lib/types/client/service.d.ts', sha: 'b4e368231d5bccdcdf5442a8eb3f00636eadabc0750e9267a7cdb12d081ce695', pairs: [['    registerSource(src: InputTriggerSource): () => void;', declaration + '    registerSource(src: InputTriggerSource): () => void;']] },
  { path: 'lib/types/client/contract.d.ts', sha: '0fd1efa96500786741a956fa7dcb16d7e17a5f356f5f083d42bb9fa92674fd7a', pairs: [['    registerSource(src: InputTriggerSource): () => void;', declaration + '    registerSource(src: InputTriggerSource): () => void;']] },
  { path: 'lib/types/types.d.ts', sha: '3995e7b30021ecf61919b73c21fe4e4488b241a1dc930be6f9da994103c25fea', pairs: [['    onPick(pick: InputTriggerPick): PickOutcome;', '    /** Refresh menu candidates after a disclosure, without changing or submitting the draft. */\n    onPick(pick: InputTriggerPick): PickOutcome | { readonly refresh: true };']] },
] as const;
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
for (const patch of patches) {
  const path = new URL('../node_modules/@deepseek-ai/dsh-client-ui-input-trigger/' + patch.path, import.meta.url), source = readFileSync(path, 'utf8');
  let base = source;
  if (sha(base) !== patch.sha) {
    for (const [before, after] of [...patch.pairs].reverse()) base = base.replace(after, before);
    if (sha(base) !== patch.sha) throw new Error('Unknown DSH source registry; review input-source filter patch');
  }
  // Reapply to the verified base so an older subset of these seams upgrades
  // instead of being mistaken for an already complete patch.
  let result = base;
  for (const [before, after] of patch.pairs) { if (result.split(before).length !== 2) throw new Error('Input source filter anchor changed'); result = result.replace(before, after); }
  if (result !== source) writeFileSync(path, result);
}
