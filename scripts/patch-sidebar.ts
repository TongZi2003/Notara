import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// A replacement cannot redeclare another slot owner's children. Keep all six
// original seats under the native SidebarRoot, and add a content seat that
// receives its authorized render function by ordinary props delegation.
// Removing the StudyForge occupant immediately restores NativeSidebarRoot.
const path = new URL('../node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js', import.meta.url);
const original = '171e3f0014e09c0f907e04e3a5503cae937bdd7169e3dc5f5c63e0e2671f64e0';
const replacements = [
  ['function SidebarRoot({', 'function NativeSidebarRoot({'],
  ['const NS = "sidebar";', 'function SidebarRoot(props) {\n\t\t\treturn props.renderSlot("sidebar.content", { collapsed: props.collapsed, width: props.width, renderSidebarSlot: props.renderSlot }, { fallback: (0, react_jsx_runtime.jsx)(NativeSidebarRoot, props) });\n\t\t}\n\t\tconst NS = "sidebar";'],
  ['children: {\n\t\t\t\t\t"sidebar.brand.mark": {', 'children: {\n\t\t\t\t\t"sidebar.content": { kind: "single", scope: "root" },\n\t\t\t\t\t"sidebar.brand.mark": {'],
] as const;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const source = readFileSync(path, 'utf8');
if (sha(source) === original) {
  let result = source;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error('DSH sidebar content seam anchor changed');
    result = result.replace(before, after);
  }
  writeFileSync(path, result);
} else {
  let reversed = source;
  for (const [before, after] of [...replacements].reverse()) reversed = reversed.replace(after, before);
  if (sha(reversed) !== original) throw new Error('Unknown DSH sidebar artifact; review content seam patch');
}
