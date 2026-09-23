import type { SpriteData } from '../upstream/webview-ui/src/office/types';
import { getCachedSprite as nativeSprite } from '../upstream/webview-ui/src/office/sprites/spriteCache';
export { getOutlineSprite } from '../upstream/webview-ui/src/office/sprites/spriteCache';
import { findCharacterArt } from './character-art';

const cache = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>();
/** Higher-detail character art uses the native 16x32 world-space footprint.
 * Furniture, bubbles, hit-testing, outlines and spawn effects remain native. */
export function getCachedSprite(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  const source = findCharacterArt(sprite);
  if (!source) return nativeSprite(sprite, zoom);
  let sprites = cache.get(zoom);
  if (!sprites) { sprites = new WeakMap(); cache.set(zoom, sprites); }
  const existing = sprites.get(sprite);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = 16 * zoom; canvas.height = 32 * zoom;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (source.flipped) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source.image, source.column * 64, source.row * 128, 64, 128, 0, 0, canvas.width, canvas.height);
  sprites.set(sprite, canvas);
  return canvas;
}
