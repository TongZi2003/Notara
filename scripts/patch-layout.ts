import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// DSH 0.2.0 hard-codes a 280px sidebar reset. Native Vault's sidebar is a 56px
// rail plus its panel (360px). Add a narrow, reversible geometry action so the
// *native* column solver, resize handles and narrow/rightbar concessions agree
// on it; the native 264–420px range is kept. Defaults remain 280px unless a
// deployment calls the new action.
const patches = [
  {
    path: 'lib/client.js', sha: '587d109681891295aed5bf0a4b1ca7c005113124be5b043246f09fccce47f492',
    replacements: [
      // The hidden native right sidebar extends beyond the frame. `hidden`
      // makes that outer frame programmatically scrollable: focusing a graph
      // node or navigating an editor can pan the entire app into the offscreen
      // column. Only the inner panes should scroll; the shell is a clip frame.
      ['grid-template-rows:100%;height:100%;display:grid;position:relative;overflow:hidden', 'grid-template-rows:100%;height:100%;display:grid;position:relative;overflow:clip'],
      ['layoutInfo.sidebar === 0 ? 280 : layoutInfo.sidebar', 'layoutInfo.sidebar === 0 ? layoutInfo.sidebarDefault : layoutInfo.sidebar'],
      ['sidebar: 280,', 'sidebar: 280,\n\t\t\t\t\t\tsidebarDefault: 280,'],
      ['setSidebar: (d, px) => {', 'setSidebarDefaultWidth: (d, px) => {\n\t\t\t\t\t\td.layoutInfo.sidebarDefault = clampWidth(px, 264, 420);\n\t\t\t\t\t\tif (d.layoutInfo.sidebar !== 0) d.layoutInfo.sidebar = d.layoutInfo.sidebarDefault;\n\t\t\t\t\t},\n\t\t\t\t\tsetSidebar: (d, px) => {'],
      ['d.layoutInfo.sidebar === 0 ? 280 : 0', 'd.layoutInfo.sidebar === 0 ? d.layoutInfo.sidebarDefault : 0'],
      ['toggleSidebar() {\n\t\t\t\tthis.panels.toggleSidebar();', 'setSidebarDefaultWidth(width) {\n\t\t\t\tthis.panels.setSidebarDefaultWidth(width);\n\t\t\t}\n\t\t\ttoggleSidebar() {\n\t\t\t\tthis.panels.toggleSidebar();'],
    ],
  },
  {
    path: 'lib/types/client/service.d.ts', sha: '5a7ba6db633eeda6792179fd13be316dcc06fd640b5413e2267068f70db7424e',
    replacements: [
      ['export interface ILayout {', 'export interface ILayout {\n    /** Deployment sidebar width, 264–420px; native geometry and toggling retain it. */\n    setSidebarDefaultWidth(width: number): void;'],
      ['export declare class LayoutController implements ILayout {', 'export declare class LayoutController implements ILayout {\n    setSidebarDefaultWidth(width: number): void;'],
    ],
  },
] as const;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
for (const patch of patches) {
  const path = new URL('../node_modules/@deepseek-ai/dsh-client-ui-layout/' + patch.path, import.meta.url);
  const source = readFileSync(path, 'utf8');
  let original = source;
  if (sha(source) !== patch.sha) {
    let reversed = source;
    for (const [before, after] of [...patch.replacements].reverse()) reversed = reversed.replace(after, before);
    if (sha(reversed) !== patch.sha) throw new Error('Unknown DSH layout artifact; review notebook geometry patch: ' + patch.path);
    original = reversed;
  }
  // Rebuild from the verified upstream artifact so older patch revisions also
  // acquire newly added replacements. Re-running an up-to-date patch is a no-op.
  let result = original;
  for (const [before, after] of patch.replacements) {
    if (result.split(before).length !== 2) throw new Error('DSH layout patch anchor changed: ' + patch.path);
    result = result.replace(before, after);
  }
  if (result !== source) writeFileSync(path, result);
}
