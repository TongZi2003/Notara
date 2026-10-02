import data from './academy-data.json' with { type: 'json' };

/** Public character display material only; never used by teaching prompts or settings. */
export const ACADEMY = data;
export const CHARACTERS = data.characters;
export const ACADEMY_PATH = '/notara/vault/academy';
export const ACADEMY_FILES = Object.fromEntries([
  ...CHARACTERS.map(character => [`${character.id}-profile.webp`, 'image/webp']),
  ['notara.svg', 'image/svg+xml'], ['notara.ico', 'image/x-icon'],
  ['gallery.html', 'text/html; charset=utf-8'], ['gallery.css', 'text/css; charset=utf-8'],
  ['gallery.js', 'text/javascript; charset=utf-8'], ['catalog.json', 'application/json; charset=utf-8'],
]);
export function academyUrl(name) {
  if (!Object.hasOwn(ACADEMY_FILES, name)) throw new Error('academy_asset_unknown');
  return `${ACADEMY_PATH}/${name}?v=20261003`;
}
