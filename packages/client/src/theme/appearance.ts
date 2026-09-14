export const APPEARANCE_KEY = 'studyforge.notebook.appearance';
export type Appearance = { style: 'modern' | 'notebook'; scheme: 'jia' | 'yi' | 'bing' | 'ding'; size: 's' | 'm' | 'l'; face: 'print' | 'hand'; paper: 'hengxian' | 'fangge'; tone: 'yellow' | 'white'; table: 'follow' | 'print' };
export const DEFAULT_APPEARANCE: Appearance = { style: 'modern', scheme: 'jia', size: 'm', face: 'print', paper: 'hengxian', tone: 'yellow', table: 'follow' };
const OPTIONS = { style: ['modern', 'notebook'], scheme: ['jia', 'yi', 'bing', 'ding'], size: ['s', 'm', 'l'], face: ['print', 'hand'], paper: ['hengxian', 'fangge'], tone: ['yellow', 'white'], table: ['follow', 'print'] } as const;
/** Two complete themes. Older paper preferences remain available on return. */
export function readAppearance(value: unknown): Appearance {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_APPEARANCE };
  for (const key of Object.keys(OPTIONS) as (keyof Appearance)[]) {
    if ((OPTIONS[key] as readonly unknown[]).includes(raw[key])) Object.assign(result, { [key]: raw[key] });
  }
  if (raw.enabled === false || raw.style === 'soft') result.style = 'modern';
  else if (raw.style === undefined && raw.enabled === true) result.style = 'notebook';
  return result;
}
