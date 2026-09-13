import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
// rc.2 keeps the raw slot roster. Gate only deployment-selected debug entries;
// native view state and fallback stay with the original conversation controller.
const file = new URL('../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url);
const original = '677c5fa3788255531d3655917fafc2f55077ad7803d4da10cda7739c68f873cf';
const changes = [
  ['if (entry.options.id === void 0) continue;', 'if (entry.options.id === void 0) continue;\n\t\t\t\t\tif (entry.options.id === "trajectory" && document.documentElement.dataset.studyforgeDebug === "false") continue;'],
  ['const disposeViews = slots.subscribe("conversation.view", refreshViews);', 'const disposeViews = slots.subscribe("conversation.view", refreshViews);\n\t\t\t\twindow.addEventListener("studyforge:debug-views", refreshViews);'],
  ['disposeLocale();\n\t\t\t\t\tdisposeViews();', 'disposeLocale();\n\t\t\t\t\tdisposeViews();\n\t\t\t\t\twindow.removeEventListener("studyforge:debug-views", refreshViews);'],
  ['function ConversationRoot({', 'function NativeConversationRoot({'],
  ['function ConversationPanel({ renderSlot }) {', 'function ConversationRoot(props) {\n\t\t\tconst nativeConversation = (0, react_jsx_runtime.jsx)(NativeConversationRoot, props);\n\t\t\treturn props.renderSlot("conversation.workspace", { nativeConversation }, { fallback: nativeConversation });\n\t\t}\n\t\tfunction ConversationPanel({ renderSlot }) {'],
  ['name: "main.conversation",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: {', 'name: "main.conversation",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: {\n\t\t\t\t\t"conversation.workspace": { kind: "single", scope: "session-maybe" },'],
] as const;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
/** Normalize before the earlier native-input digest gate, including on npm ci. */
export function stripConversationSeams(source: string): string {
  let result = source; for (const [a, b] of [...changes].reverse()) result = result.replace(b, a); return result;
}
export function applyConversationSeams(): void {
  const source = readFileSync(file, 'utf8'), base = stripConversationSeams(source);
  if (hash(base) !== original) throw new Error('Unknown rc.2 conversation build: review workspace seam');
  let result = base;
  for (const [a, b] of changes) { if (result.split(a).length !== 2) throw new Error('Conversation workspace patch anchor changed'); result = result.replace(a, b); }
  if (result !== source) writeFileSync(file, result);
}
