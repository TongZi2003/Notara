import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const effectBefore = `			(0, react.useEffect)(() => {
				if (catalogProvider === void 0) return;
				let current = true;
				operations.discoverModels(probe.settingsNs, { provider: catalogProvider }).then((answer) => {
					if (!current) return;
					setInheritedCatalog({
						provider: catalogProvider,
						models: answer.kind === "found" ? answer.models : []
					});
					setFailure(answer.kind === "refused" ? answer.message : void 0);
				});
				return () => {
					current = false;
				};
			}, [
				catalogProvider,
				operations,
				probe.settingsNs
			]);`;
const effectAfter = `			(0, react.useEffect)(() => {
				const requests = props.initialCatalogRequests;
				if (catalogProvider === void 0 || requests === void 0) return;
				const key = probe.settingsNs + ":" + catalogProvider;
				let entry = requests.get(key);
				if (!entry) {
					entry = { work: operations.discoverModels(probe.settingsNs, {
						provider: catalogProvider,
						...probe.baseURL ? { baseURL: probe.baseURL } : {},
						...probe.api === void 0 ? {} : { api: probe.api },
						...probe.apiKey === void 0 ? {} : { apiKey: probe.apiKey }
					}) };
					requests.set(key, entry);
				}
				let current = true;
				setBusy(true);
				entry.work.then((answer) => {
					if (!current) return;
					if (answer.kind === "found") entry.lastGood = answer.models;
					const found = entry.lastGood ?? [];
					setInheritedCatalog({ provider: catalogProvider, models: found });
					setFailure(answer.kind === "refused" ? answer.message : found.length ? void 0 : t("fetchEmpty"));
					if (answer.kind === "found" && found.length) {
						const known = new Set(models.map(model => textOf(model, "id")));
						setCandidates(found);
						setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)));
					}
				}).catch(() => {
					if (!current) return;
					setInheritedCatalog({ provider: catalogProvider, models: entry.lastGood ?? [] });
					setFailure(t("fetchEmpty"));
				})
					.finally(() => { if (current) setBusy(false); });
				return () => { current = false; };
			}, [catalogProvider, operations, probe.settingsNs, props.initialCatalogRequests]);`;

const replacements = Object.freeze([
  { before: effectBefore, after: effectAfter },
  { before: 'inputLoading: catalogProvider !== void 0 && catalog === void 0,', after: 'inputLoading: catalogProvider !== void 0 && busy,' },
  { before: 'const [addOpen, setAddOpen] = (0, react.useState)(false);', after: 'const [addOpen, setAddOpen] = (0, react.useState)(false);\n\t\t\tconst initialCatalogRequests = (0, react.useRef)(new Map()).current;' },
  { before: 'const first = addable[0];\n\t\t\t\t\t\t\t\t\tconst initial = catalogEnabled ? "catalog" : "custom";', after: 'initialCatalogRequests.clear();\n\t\t\t\t\t\t\t\t\tconst first = addable[0];\n\t\t\t\t\t\t\t\t\tconst initial = catalogEnabled ? "catalog" : "custom";' },
  { before: 'hideTitle: true,\n\t\t\t\t\t\t\t\t\t\t\tnamespace: draft.namespace,', after: 'hideTitle: true,\n\t\t\t\t\t\t\t\t\t\t\tinitialCatalogRequests,\n\t\t\t\t\t\t\t\t\t\t\tnamespace: draft.namespace,' },
  { before: 'catalogProvider: props.declared === true ? void 0 : props.provider,', after: 'catalogProvider: props.declared === true ? void 0 : props.provider,\n\t\t\t\t\t\t\t\tinitialCatalogRequests: props.initialCatalogRequests,' },
  { before: 'const answer = await operations.discoverModels(probe.settingsNs, {', after: 'const work = operations.discoverModels(probe.settingsNs, {' },
  { before: '\t\t\t\t\t});\n\t\t\t\t\tif (answer.kind === "refused") {', after: '\t\t\t\t\t});\n\t\t\t\t\tconst requests = props.initialCatalogRequests;\n\t\t\t\t\tconst key = probe.settingsNs + ":" + catalogProvider;\n\t\t\t\t\tconst entry = { work, lastGood: requests?.get(key)?.lastGood };\n\t\t\t\t\tif (catalogProvider !== void 0) requests?.set(key, entry);\n\t\t\t\t\tconst answer = await work;\n\t\t\t\t\tif (answer.kind === "refused") {' },
  { before: '\t\t\t\t\tconst found = answer.models;', after: '\t\t\t\t\tconst found = answer.models;\n\t\t\t\t\tentry.lastGood = found;' },
  { before: '\t\t\t\t\tsetPicked(new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id)));\n\t\t\t\t} finally {', after: '\t\t\t\t\tsetPicked(new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id)));\n\t\t\t\t} catch {\n\t\t\t\t\tsetFailure(t("fetchEmpty"));\n\t\t\t\t} finally {' },
]);
export const MODEL_DISCOVERY_UI_PATCH = Object.freeze({
  artifact: '@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
  originalSha: '7674ed0ba2eef60fa7db91b4bf8cea4dc23e1f0a2f3dd1e6a2a67ad4c0d005fa',
  patchedSha: 'f192285eac1bcaa3706c49d19f8a49f6f3abc178feed22f5bb9b7bd55d0f1a2c', replacements,
});
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export function patchModelDiscovery(source: string): string {
  if (sha(source) === MODEL_DISCOVERY_UI_PATCH.patchedSha) return source;
  if (sha(source) !== MODEL_DISCOVERY_UI_PATCH.originalSha) throw new Error('Unknown DSH model settings UI artifact');
  let result = source;
  for (const { before, after } of replacements) {
    if (result.split(before).length !== 2) throw new Error('DSH model discovery UI patch anchor changed');
    result = result.replace(before, after);
  }
  if (sha(result) !== MODEL_DISCOVERY_UI_PATCH.patchedSha) throw new Error('DSH model discovery UI patch digest mismatch');
  return result;
}
export function applyModelDiscoveryPatch(): void {
  const file = fileURLToPath(new URL(`../node_modules/${MODEL_DISCOVERY_UI_PATCH.artifact}`, import.meta.url));
  const source = readFileSync(file, 'utf8'), patched = patchModelDiscovery(source);
  if (source !== patched) writeFileSync(file, patched);
  console.log('Verified DSH model discovery once per new provider draft');
}
