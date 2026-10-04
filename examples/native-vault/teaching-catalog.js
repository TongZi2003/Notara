import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundled = new URL('./teaching/manifest.json', import.meta.url);
const source = new URL('../../resources/vault-teaching/manifest.json', import.meta.url);
const manifestUrl = existsSync(bundled) ? bundled : source;
const root = new URL('./', manifestUrl);
export const TEACHING_PRESET = 'notara-teacher';
export const teachingManifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
export const teachingChoices = teachingManifest.choices.map(({id,title,description})=>({id,title,description}));
export const defaultTeachingRef = teachingManifest.default;
/** Previously saved calls and classroom drafts can still resolve to the merged resources. */
export const teachingLegacyAliases = Object.freeze({
  socratic: 'mixed', feynman: 'mixed', lecture: 'mixed', structural: 'mixed',
  brainstorm: 'consolidation', 'markdown-handout': 'material-outline', 'route-planning': 'lesson-preparation',
});
export function canonicalTeachingId(id) { return teachingLegacyAliases[id] ?? id; }
export function teachingResource(path) {
  if (typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..')) throw new Error('teaching_resource_invalid');
  return readFileSync(new URL(path, root), 'utf8');
}
export function currentTeachingBody(id) {
  const choice = teachingManifest.choices.find(item=>item.id===canonicalTeachingId(id));
  if (!choice) throw new Error('teaching_choice_invalid');
  return teachingResource(choice.file);
}
export function teachingResourcePath(path) { return fileURLToPath(new URL(path, root)); }
