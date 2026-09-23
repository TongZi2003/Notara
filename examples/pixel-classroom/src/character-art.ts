import type { SpriteData } from '../upstream/webview-ui/src/office/types';

interface CharacterArt { image: HTMLImageElement; column: number; row: number; flipped: boolean }
const art = new WeakMap<SpriteData, CharacterArt | null>();
const mirrored = new Map<string, CharacterArt>();
export function registerCharacterArt(sprite: SpriteData, image: HTMLImageElement, column: number, row: number) {
  art.set(sprite, { image, column, row, flipped: false });
  // Upstream creates left-facing arrays by mirroring row three. Resolve those
  // once and cache by object; no hashing or image decode in the animation loop.
  if (row === 2) mirrored.set(JSON.stringify(sprite.map(line => [...line].reverse())), { image, column, row, flipped: true });
}
export function findCharacterArt(sprite: SpriteData): CharacterArt | null {
  if (art.has(sprite)) return art.get(sprite) ?? null;
  const match = sprite.length === 32 && sprite[0]?.length === 16 ? mirrored.get(JSON.stringify(sprite)) ?? null : null;
  art.set(sprite, match);
  return match;
}
