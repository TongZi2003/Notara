import type { SpriteData } from '../upstream/webview-ui/src/office/types';
import { registerCharacterArt } from './character-art';

export const CHARACTER_SKINS = [
  { id: 'deepseek', label: '大肥鱼', palette: 0 },
  { id: 'gpt', label: 'GPT', palette: 1 },
  { id: 'claude', label: 'Claude', palette: 2 },
  { id: 'kimi', label: 'Kimi', palette: 3 },
  { id: 'glm', label: 'GLM', palette: 4 },
] as const;
export type CharacterSkin = typeof CHARACTER_SKINS[number];
export type SkinId = CharacterSkin['id'];
export type SkinChoices = Record<string, SkinId>;
const STORAGE_KEY = 'notara.pixel-classroom.skins.v1';
const DEFAULT_SKINS: Record<string, SkinId> = {
  teacher: 'deepseek', helperA: 'gpt', helperB: 'claude',
  problem: 'gpt', review: 'claude', lesson: 'kimi', general: 'glm', exercise: 'gpt',
};
function isSkinId(value: unknown): value is SkinId {
  return CHARACTER_SKINS.some(skin => skin.id === value);
}
export function readSkinChoices(): SkinChoices {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, value]) => isSkinId(value))) as SkinChoices;
  } catch { return {}; }
}
export function saveSkinChoices(choices: SkinChoices): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(choices)); }
  catch { /* An unavailable browser store must not interrupt a lesson. */ }
}
export function characterSkin(roleKey: string, choices: SkinChoices): CharacterSkin {
  const id = choices[roleKey] ?? DEFAULT_SKINS[roleKey] ?? 'glm';
  return CHARACTER_SKINS.find(skin => skin.id === id) ?? CHARACTER_SKINS[0];
}
export function skinSheetUrl(id: SkinId): string {
  return `./assets/ai-characters/${id}.detail.png`;
}

/** Native Pixel Agents contract: 7 frames per direction, 16x32 pixels each. */
export async function loadCharacterSkins(): Promise<Array<{ down: SpriteData[]; up: SpriteData[]; right: SpriteData[] }>> {
  return Promise.all(CHARACTER_SKINS.map(async skin => {
    const load = async (url: string) => {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`${skin.label}角色素材加载失败`));
        image.src = url;
      });
      return image;
    };
    const [image, detail] = await Promise.all([load(`./assets/ai-characters/${skin.id}.png`), load(skinSheetUrl(skin.id))]);
    if (image.naturalWidth !== 112 || image.naturalHeight !== 96) throw new Error(`${skin.label}角色图集尺寸不正确`);
    if (detail.naturalWidth !== 448 || detail.naturalHeight !== 384) throw new Error(`${skin.label}角色细节图集尺寸不正确`);
    const canvas = document.createElement('canvas');
    canvas.width = 112; canvas.height = 96;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取角色素材');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, 112, 96);
    const frames = (row: number): SpriteData[] => Array.from({ length: 7 }, (_, frame) => {
      const sprite = Array.from({ length: 32 }, (_, y) => Array.from({ length: 16 }, (_, x) => {
        const i = ((row * 32 + y) * 112 + frame * 16 + x) * 4;
        return data[i + 3] < 128 ? '' : `#${[data[i], data[i + 1], data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
      }));
      registerCharacterArt(sprite, detail, frame, row);
      return sprite;
    });
    return { down: frames(0), up: frames(1), right: frames(2) };
  }));
}
