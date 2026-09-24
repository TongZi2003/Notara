import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
// rc.2 keeps the raw slot roster. Gate only deployment-selected debug entries;
// native view state and fallback stay with the original conversation controller.
const file = new URL('../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url);
const original = '677c5fa3788255531d3655917fafc2f55077ad7803d4da10cda7739c68f873cf';
const changes = [
  // Expose only the empty lesson's introduction. The native input and its seat
  // remain siblings owned by ConversationRoot, with the original UI as fallback.
  ['"conversation.hero.brand.mark": {', '"conversation.hero.intro": { kind: "single", scope: "root" },\n\t\t\t\t\t"conversation.hero.brand.mark": {'],
  ['hero && (0, react_jsx_runtime.jsx)(HeroShell, {\n\t\t\t\t\t\tt,\n\t\t\t\t\t\trenderSlot\n\t\t\t\t\t}),\n\t\t\t\t\thero && heroWorkspaceRow,', 'hero && renderSlot("conversation.hero.intro", { nativeWorkspaceSelector: heroWorkspaceRow, needsWorkspace: inert }, { fallback: (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [(0, react_jsx_runtime.jsx)(HeroShell, { t, renderSlot }), heroWorkspaceRow] }) }),'],
  // Keep the native submit/stop control; expose its foreground for pale themes.
  ['background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;', 'background:var(--dsw-alias-button-info-fill);color:var(--dsh-composer-primary-color,#fff);cursor:pointer;'],
  // The scroll body owns scrolling. Keep the conversation shell from being
  // panned horizontally by focus when its narrow composer overflows.
  ['.wSkVaW_root[data-phase=active]{overflow:hidden}', '.wSkVaW_root[data-phase=active]{overflow:clip}'],
  ['if (entry.options.id === void 0) continue;', 'if (entry.options.id === void 0) continue;\n\t\t\t\t\tif (entry.options.id === "trajectory" && document.documentElement.dataset.studyforgeDebug === "false") continue;'],
  ['const disposeViews = slots.subscribe("conversation.view", refreshViews);', 'const disposeViews = slots.subscribe("conversation.view", refreshViews);\n\t\t\t\twindow.addEventListener("studyforge:debug-views", refreshViews);'],
  ['disposeLocale();\n\t\t\t\t\tdisposeViews();', 'disposeLocale();\n\t\t\t\t\tdisposeViews();\n\t\t\t\t\twindow.removeEventListener("studyforge:debug-views", refreshViews);'],
  ['function ConversationRoot({', 'function NativeConversationRoot({'],
  ['function ConversationPanel({ renderSlot }) {', "function ConversationRoot(props) {\n\t\t\tconst nativeConversation = (0, react_jsx_runtime.jsx)(NativeConversationRoot, props);\n\t\t\tconst nativeConversationBody = (0, react_jsx_runtime.jsx)(NativeConversationRoot, { ...props, externalHeader: true, viewId: \"chat\" });\n\t\t\tconst nativeHeader = props.sessionId === void 0 ? null : props.renderSlot(\"conversation.session.header\", { hideTabs: true });\n\t\t\tconst nativeTrajectory = props.sessionId === void 0 ? null : props.renderSlot(\"conversation.session\", { viewId: \"trajectory\", mirrorDraft: false });\n\t\t\treturn props.renderSlot(\"conversation.workspace\", { nativeConversation, nativeConversationBody, nativeHeader, nativeTrajectory }, { fallback: nativeConversation });\n\t\t}\n\t\tfunction ConversationPanel({ renderSlot }) {"],
  ['name: "main.conversation",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: {', 'name: "main.conversation",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: {\n\t\t\t\t\t"conversation.workspace": { kind: "single", scope: "session-maybe" },'],
  ["function NativeConversationRoot({","function NativeConversationRoot({ externalHeader = false, viewId,"],
  ["children: [sessionId === void 0 ? null : renderSlot(\"conversation.session.header\", {}),","children: [sessionId === void 0 || externalHeader ? null : renderSlot(\"conversation.session.header\", {}),"],
  ["children: [sessionId === void 0 ? null : renderSlot(\"conversation.session\", {}), composerSeat]","children: [sessionId === void 0 ? null : renderSlot(\"conversation.session\", { viewId }), composerSeat]"],
  ["function ConversationSessionHeader({ sessionId,","function ConversationSessionHeader({ hideTabs = false, sessionId,"],
  ["tabs.length > 1 && (0, react_jsx_runtime.jsx)(\"div\",","!hideTabs && tabs.length > 1 && (0, react_jsx_runtime.jsx)(\"div\","],
  ["function ConversationSession({ useSession,","function ConversationSession({ viewId, mirrorDraft = true, useSession,"],
  ["const active = resolveActiveView(useConversationViews((value) => value), useStore((s) => s.view));","const storedView = useStore((s) => s.view);\n\t\t\tconst active = resolveActiveView(useConversationViews((value) => value), viewId ?? storedView);"],
  ["if (inputState.draft === \"\" && storedDraft !== \"\") inputActions.setDraft(storedDraft);","if (!mirrorDraft) return;\n\t\t\t\tif (inputState.draft === \"\" && storedDraft !== \"\") inputActions.setDraft(storedDraft);"],
] as const;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
/** Normalize before the earlier native-input digest gate, including on npm ci. */
export function stripConversationSeams(source: string): string {
  let result = source.replace("const active = resolveActiveView(useConversationViews((value) => value), viewId ?? useStore((s) => s.view));", "const storedView = useStore((s) => s.view);\n\t\t\tconst active = resolveActiveView(useConversationViews((value) => value), viewId ?? storedView);").replace("function ConversationRoot(props) {\n\t\t\tconst nativeConversation = (0, react_jsx_runtime.jsx)(NativeConversationRoot, props);\n\t\t\treturn props.renderSlot(\"conversation.workspace\", { nativeConversation }, { fallback: nativeConversation });\n\t\t}\n\t\tfunction ConversationPanel({ renderSlot }) {", "function ConversationRoot(props) {\n\t\t\tconst nativeConversation = (0, react_jsx_runtime.jsx)(NativeConversationRoot, props);\n\t\t\tconst nativeConversationBody = (0, react_jsx_runtime.jsx)(NativeConversationRoot, { ...props, externalHeader: true, viewId: \"chat\" });\n\t\t\tconst nativeHeader = props.sessionId === void 0 ? null : props.renderSlot(\"conversation.session.header\", { hideTabs: true });\n\t\t\tconst nativeTrajectory = props.sessionId === void 0 ? null : props.renderSlot(\"conversation.session\", { viewId: \"trajectory\", mirrorDraft: false });\n\t\t\treturn props.renderSlot(\"conversation.workspace\", { nativeConversation, nativeConversationBody, nativeHeader, nativeTrajectory }, { fallback: nativeConversation });\n\t\t}\n\t\tfunction ConversationPanel({ renderSlot }) {"); for (const [a, b] of [...changes].reverse()) result = result.replace(b, a); return result;
}
export function applyConversationSeams(): void {
  const source = readFileSync(file, 'utf8'), base = stripConversationSeams(source);
  if (hash(base) !== original) throw new Error('Unknown rc.2 conversation build: review workspace seam');
  let result = base;
  for (const [a, b] of changes) { if (result.split(a).length !== 2) throw new Error('Conversation workspace patch anchor changed'); result = result.replace(a, b); }
  if (result !== source) writeFileSync(file, result);
}
