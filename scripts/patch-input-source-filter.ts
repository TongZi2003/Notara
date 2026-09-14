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
  ] },
  { path: 'lib/types/client/service.d.ts', sha: 'b4e368231d5bccdcdf5442a8eb3f00636eadabc0750e9267a7cdb12d081ce695', pairs: [['    registerSource(src: InputTriggerSource): () => void;', declaration + '    registerSource(src: InputTriggerSource): () => void;']] },
  { path: 'lib/types/client/contract.d.ts', sha: '0fd1efa96500786741a956fa7dcb16d7e17a5f356f5f083d42bb9fa92674fd7a', pairs: [['    registerSource(src: InputTriggerSource): () => void;', declaration + '    registerSource(src: InputTriggerSource): () => void;']] },
] as const;
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
for (const patch of patches) {
  const path = new URL('../node_modules/@deepseek-ai/dsh-client-ui-input-trigger/' + patch.path, import.meta.url), source = readFileSync(path, 'utf8');
  if (sha(source) !== patch.sha) {
    let reversed = source;
    for (const [before, after] of [...patch.pairs].reverse()) reversed = reversed.replace(after, before);
    if (sha(reversed) !== patch.sha) throw new Error('Unknown DSH source registry; review input-source filter patch');
    continue;
  }
  let result = source;
  for (const [before, after] of patch.pairs) { if (result.split(before).length !== 2) throw new Error('Input source filter anchor changed'); result = result.replace(before, after); }
  writeFileSync(path, result);
}
