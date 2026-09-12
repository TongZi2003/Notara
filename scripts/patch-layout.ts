import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// rc.2 hard-codes a 264px minimum and a 280px reset. The original StudyForge
// sidebar is 196px. Add a narrow, reversible geometry action so the *native*
// column solver, resize handles and narrow/rightbar concessions agree on it.
// Defaults remain 280px unless a deployment calls the new action.
const patches = [
  {
    path: 'lib/client.js', sha: '930c10a9bed1094e7bca6242276c22ba7020fd58bac47d70a0fef174544508ef',
    replacements: [
      ['clampWidth(sidebar, 264, 420)', 'clampWidth(sidebar, 196, 420)'],
      ['layoutInfo.sidebar === 0 ? 280 : layoutInfo.sidebar', 'layoutInfo.sidebar === 0 ? layoutInfo.sidebarDefault : layoutInfo.sidebar'],
      ['sidebar: 280,', 'sidebar: 280,\n\t\t\t\t\t\tsidebarDefault: 280,'],
      ['setSidebar: (d, px) => {', 'setSidebarDefaultWidth: (d, px) => {\n\t\t\t\t\t\td.layoutInfo.sidebarDefault = clampWidth(px, 196, 420);\n\t\t\t\t\t\tif (d.layoutInfo.sidebar !== 0) d.layoutInfo.sidebar = d.layoutInfo.sidebarDefault;\n\t\t\t\t\t},\n\t\t\t\t\tsetSidebar: (d, px) => {'],
      ['d.layoutInfo.sidebar = clampWidth(px, 264, 420)', 'd.layoutInfo.sidebar = clampWidth(px, 196, 420)'],
      ['d.layoutInfo.sidebar === 0 ? 280 : 0', 'd.layoutInfo.sidebar === 0 ? d.layoutInfo.sidebarDefault : 0'],
      ['toggleSidebar() {\n\t\t\t\tthis.panels.toggleSidebar();', 'setSidebarDefaultWidth(width) {\n\t\t\t\tthis.panels.setSidebarDefaultWidth(width);\n\t\t\t}\n\t\t\ttoggleSidebar() {\n\t\t\t\tthis.panels.toggleSidebar();'],
    ],
  },
  {
    path: 'lib/types/client/service.d.ts', sha: 'a54853a90ffd8e1ba018a3cc22a84b2b0bdfcb7ce9b5adf31d1dca594513dddb',
    replacements: [
      ['export interface ILayout {', 'export interface ILayout {\n    /** Deployment sidebar width, 196–420px; native geometry and toggling retain it. */\n    setSidebarDefaultWidth(width: number): void;'],
      ['export declare class LayoutController implements ILayout {', 'export declare class LayoutController implements ILayout {\n    setSidebarDefaultWidth(width: number): void;'],
    ],
  },
] as const;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
for (const patch of patches) {
  const path = new URL('../node_modules/@deepseek-ai/dsh-client-ui-layout/' + patch.path, import.meta.url);
  const source = readFileSync(path, 'utf8');
  if (sha(source) !== patch.sha) {
    let reversed = source;
    for (const [before, after] of [...patch.replacements].reverse()) reversed = reversed.replace(after, before);
    if (sha(reversed) !== patch.sha) throw new Error('Unknown DSH layout artifact; review notebook geometry patch: ' + patch.path);
    continue;
  }
  let result = source;
  for (const [before, after] of patch.replacements) {
    if (result.split(before).length !== 2) throw new Error('DSH layout patch anchor changed: ' + patch.path);
    result = result.replace(before, after);
  }
  writeFileSync(path, result);
}
