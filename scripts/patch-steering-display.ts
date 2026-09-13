import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// rc.2 renders pending steering directly, outside the public keyed message
// slots. Add a display seat with the original bubble as its fallback/renderer.
// No inbox, message, or execution state is changed; uninstall uses the fallback.
const file = new URL('../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js', import.meta.url);
const original = '6527556d25c7b2a27f2e3bfb96cc2ae3d9244f1213147e245b17684ad8d9e396';
const replacements = [
  ['"conversation.chat.node": {\n\t\t\t\t\t\t\tkind: "keyed",',
    '"conversation.chat.pending": { kind: "single", scope: "session" },\n\t\t\t\t\t\t"conversation.chat.node": {\n\t\t\t\t\t\t\tkind: "keyed",'],
  ['pendingSteering.map((item) => (0, react_jsx_runtime.jsx)(PendingSteeringBubble, {\n\t\t\t\t\t\t\t\t\tcontent: item.content,\n\t\t\t\t\t\t\t\t\trenderMessageImages,\n\t\t\t\t\t\t\t\t\tt\n\t\t\t\t\t\t\t\t}, item.id)),',
    'pendingSteering.map((item) => (0, react_jsx_runtime.jsx)(react.Fragment, { children: renderSlot("conversation.chat.pending", { content: item.content, renderMessageImages, t, native: PendingSteeringBubble }, { fallback: (0, react_jsx_runtime.jsx)(PendingSteeringBubble, { content: item.content, renderMessageImages, t }) }) }, item.id)),'],
] as const;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const source = readFileSync(file, 'utf8');
if (sha(source) !== original) {
  let reversed = source;
  for (const [before, after] of [...replacements].reverse()) reversed = reversed.replace(after, before);
  if (sha(reversed) !== original) throw new Error('Unknown DSH chat artifact; review pending-steering display seat');
} else {
  let patched = source;
  for (const [before, after] of replacements) {
    if (patched.split(before).length !== 2) throw new Error('DSH pending-steering patch anchor changed');
    patched = patched.replace(before, after);
  }
  writeFileSync(file, patched);
}
