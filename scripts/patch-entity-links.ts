import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// This runs in both the published ESM primitives and the shipped Vite shell.
// No captured session/owner is frozen into incremental Markdown blocks.
export const pendingReferenceHelper = String.raw`function sfPendingReference(text) {
  const match = /\[((?:\\.|[^\]\\\n])*)\]\(#studyforge\/reference\/[A-Za-z0-9_-]*$/.exec(text);
  if (!match) return text;
  const before = text.slice(0, match.index);
  let fence = null, inline = null;
  for (const line of before.split('\n')) {
    const mark = /^ {0,3}(\x60{3,}|~{3,})/.exec(line);
    if (mark) { if (!fence) fence = mark[1]; else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null; continue; }
    if (!fence) for (const tick of line.matchAll(/(?<!\\)\x60+/g)) inline = inline === tick[0] ? null : inline ?? tick[0];
  }
  return fence || inline ? text : before + match[1];
}
`;
const patches = [
  { path: 'dsh-client-ui-primitives/lib/index.js', sha: 'cd55c03145232b49894dc7d9719b66ded954c4f0ae6ac70f3df759cdf7c36804', changes: [
    ['function renderSafeLink(href, children, key, glyph = true) {', pendingReferenceHelper + 'function renderSafeLink(href, children, key, glyph = true) {\n\tif (/^#studyforge\\/reference\\/[A-Za-z0-9_-]+$/.test(href)) return jsx("a", { href, "data-studyforge-reference": href, children }, key);'],
    ['const MarkdownText = memo(function MarkdownText({ text, streaming = false, labels, fileMentions, pathImages }) {', 'const MarkdownText = memo(function MarkdownText({ text, streaming = false, labels, fileMentions, pathImages }) {\n\tif (streaming) text = sfPendingReference(text);'],
  ] },
  { path: 'dsh-web-frontend/dist/assets/index-BKQ_L1z6.js', sha: 'ae6b5df63da1ac26890eeb1847272005ab3860048d8fb46de1d08732861703c3', changes: [
    ['function C8(t,r,i,s=!0){', pendingReferenceHelper + 'function C8(t,r,i,s=!0){if(/^#studyforge\\/reference\\/[A-Za-z0-9_-]+$/.test(t))return d.jsx("a",{href:t,"data-studyforge-reference":t,children:r},i);'],
    ['const w8=I.memo(function({text:r,streaming:i=!1,labels:s,fileMentions:a,pathImages:c}){', 'const w8=I.memo(function({text:r,streaming:i=!1,labels:s,fileMentions:a,pathImages:c}){if(i)r=sfPendingReference(r);'],
  ] },
] as const;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
for (const patch of patches) {
  const file = new URL('../node_modules/@deepseek-ai/' + patch.path, import.meta.url), source = readFileSync(file, 'utf8');
  let base = source;
  for (const [before, after] of [...patch.changes].reverse()) base = base.replace(after, before);
  if (sha(base) !== patch.sha) throw new Error('Unknown rc.2 Markdown build; review internal-reference seam: ' + patch.path);
  let result = base;
  for (const [before, after] of patch.changes) {
    if (result.split(before).length !== 2) throw new Error('Internal-reference patch anchor changed');
    result = result.replace(before, after);
  }
  if (result !== source) writeFileSync(file, result);
}
