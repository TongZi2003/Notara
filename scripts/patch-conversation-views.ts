import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
// DSH 0.2.0 renders the main conversation through the `conversation.content`
// component factory. Native Vault needs three seams it does not offer:
// - `conversation.hero.intro`: the empty lesson's introduction, with the native
//   workspace selector handed over as a prop and the native hero as fallback;
// - `conversation.workspace`: one occupant that places the native header and a
//   chat-only conversation body inside Notara's lesson layout (对话 / 白板 / 教室),
//   falling back to the untouched native conversation;
// - `hideTabs` on the session header, since the lesson layout owns the view switch.
// The trajectory is not a pane of its own: 0.2.0 keeps one editor per session, so
// 显示调试记录 shows the native tabs and the conversation switches to it in place.
const file = new URL('../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url);
// The 0.2.0 file after patch-sdk.ts's own pending-display edits.
const original = 'd0d57935a3d4af01b47ffae18094a20883dd08f891d6d4b2f5ae254177794d6f';
const changes = [
  // Expose only the empty lesson's introduction. The native input and its seat
  // remain siblings owned by the conversation content, with the original UI as fallback.
  ['"conversation.hero.brand.mark": {', '"conversation.hero.intro": { kind: "single", scope: "root" },\n\t\t\t\t\t"conversation.hero.brand.mark": {'],
  ['hero && (0, react_jsx_runtime.jsx)(HeroShell, {\n\t\t\t\t\t\tt,\n\t\t\t\t\t\trenderSlot\n\t\t\t\t\t}),\n\t\t\t\t\thero && heroWorkspaceRow,', 'hero && renderSlot("conversation.hero.intro", { nativeWorkspaceSelector: heroWorkspaceRow, needsWorkspace: inert }, { fallback: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(HeroShell, {\n\t\t\t\t\t\tt,\n\t\t\t\t\t\trenderSlot\n\t\t\t\t\t}), heroWorkspaceRow] }) }),'],
  // Keep the native submit/stop control; expose its foreground for pale themes.
  ['background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;', 'background:var(--dsw-alias-button-info-fill);color:var(--dsh-composer-primary-color,#fff);cursor:pointer;'],
  // The scroll body owns scrolling. Keep the conversation shell from being
  // panned horizontally by focus when its narrow composer overflows.
  ['.wSkVaW_root[data-phase=active]{overflow:hidden}', '.wSkVaW_root[data-phase=active]{overflow:clip}'],
  // The workspace wrapper around the native main panel: a chat-only body with the
  // header's tabs hidden, and for 显示调试记录 a body and header that follow the
  // native view tabs (the trajectory among them). Owner props win over the
  // occupant's own kit, so they carry data only: the occupant's renderSlot must
  // stay bound to its own declared children (`notara.classroom.view`).
  ['function ConversationRoot(props) {\n\t\t\treturn (0, react_jsx_runtime.jsx)(ConversationMainPanel, { ...props });\n\t\t}',
    'function NotaraChatView(props) {\n\t\t\treturn (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: props.renderSlot("conversation.session", { view: "chat" }) });\n\t\t}\n\t\tfunction ConversationRoot(props) {\n\t\t\tconst nativeConversation = (0, react_jsx_runtime.jsx)(ConversationMainPanel, { ...props });\n\t\t\tconst nativeConversationBody = (0, react_jsx_runtime.jsx)(ConversationMainPanel, { ...props, externalHeader: true, views: NotaraChatView });\n\t\t\tconst nativeDebugConversationBody = (0, react_jsx_runtime.jsx)(ConversationMainPanel, { ...props, externalHeader: true });\n\t\t\tconst nativeHeader = props.sessionId === void 0 ? null : props.renderSlot("conversation.header", { hideTabs: true });\n\t\t\tconst nativeDebugHeader = props.sessionId === void 0 ? null : props.renderSlot("conversation.header", {});\n\t\t\treturn props.renderSlot("conversation.workspace", { sessionId: props.sessionId, nativeConversation, nativeConversationBody, nativeDebugConversationBody, nativeHeader, nativeDebugHeader }, { fallback: nativeConversation });\n\t\t}'],
  ['name: "main.conversation",\n\t\t\t\tchildren: { "conversation.header": {', 'name: "main.conversation",\n\t\t\t\tchildren: { "conversation.workspace": { kind: "single", scope: "session-maybe" }, "conversation.header": {'],
  ['const { sessionId, useSession, useSessions, useConversation, renderSlot, renderFactorySlot } = props;', 'const { sessionId, useSession, useSessions, useConversation, renderSlot, renderFactorySlot, externalHeader = false, views } = props;'],
  ['children: [renderSlot("conversation.header", {}), renderFactorySlot("conversation.content", {', 'children: [externalHeader ? null : renderSlot("conversation.header", {}), renderFactorySlot("conversation.content", {'],
  ['}, { slots: { widthControls: ConversationWidthControls } })]', '}, { slots: views === void 0 ? { widthControls: ConversationWidthControls } : { widthControls: ConversationWidthControls, views } })]'],
  // The lesson layout owns the view switch, so the embedded header hides the native tabs.
  ['function ConversationHeader({ sessionId, useSession, useConversation, renderSlot }) {', 'function ConversationHeader({ hideTabs = false, sessionId, useSession, useConversation, renderSlot }) {'],
  ['renderSlot("conversation.session.header", { hideChrome: blank })]', 'renderSlot("conversation.session.header", { hideChrome: blank, hideTabs })]'],
  ['function ConversationSessionHeader({ sessionId, hideChrome,', 'function ConversationSessionHeader({ hideTabs = false, sessionId, hideChrome,'],
  ['const showTabs = !hideChrome && tabs.length > 1;', 'const showTabs = !hideTabs && !hideChrome && tabs.length > 1;'],
] as const;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
/** Undo these seams, newest first, so the earlier pending-display digest gate sees its own output. */
export function stripConversationSeams(source: string): string {
  let result = source;
  for (const [before, after] of [...changes].reverse()) result = result.replace(after, before);
  return result;
}
export function applyConversationSeams(): void {
  const source = readFileSync(file, 'utf8'), base = stripConversationSeams(source);
  if (hash(base) !== original) throw new Error('Unknown DSH conversation build: review workspace seam');
  let result = base;
  for (const [before, after] of changes) {
    if (result.split(before).length !== 2) throw new Error('DSH conversation seam anchor changed');
    result = result.replace(before, after);
  }
  if (result !== source) writeFileSync(file, result);
  console.log('Verified DSH conversation workspace seams');
}
