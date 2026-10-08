import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const before = `function routedTarget(session) {
\tconst config = session.requestHeader()?.config;
\tif (config === void 0 || config.provider.length === 0 || config.model.length === 0) return;
\treturn {
\t\tprovider: config.provider,
\t\tmodel: config.model
\t};
}`;
const after = `function routedTarget(session) {
\tconst events = session.snapshotEvents();
\tfor (let index = events.length - 1; index >= 0; index--) {
\t\tconst event = events[index];
\t\tif (event.type === "request/header") break;
\t\tif (event.type === "model/selection") {
\t\t\tconst selected = event.data;
\t\t\tif (typeof selected.provider === "string" && selected.provider.length > 0 && typeof selected.model === "string" && selected.model.length > 0)
\t\t\t\treturn { provider: selected.provider, model: selected.model };
\t\t\tbreak;
\t\t}
\t}
\tconst config = session.requestHeader()?.config;
\tif (config === void 0 || config.provider.length === 0 || config.model.length === 0) return;
\treturn {
\t\tprovider: config.provider,
\t\tmodel: config.model
\t};
}`;

const spanBefore = `function buildSummarizationInput(session, shadowedSeqs) {
\tconst header = session.requestHeader();
\tconst head = systemHead(session, session.surface.nodes[0]);
\tconst system = head === void 0 ? null : session.deriveEventMessage(head);
\tconst regionMessages = shadowedSeqs.map((seq) => session.deriveEventMessage(session.eventAt(seq))).filter((message) => message !== null);
\treturn {
\t\t...header?.tools === void 0 ? {} : { tools: header.tools },
\t\tmessages: system === null ? regionMessages : [system, ...regionMessages]
\t};
}`;
const spanAfter = `function buildSummarizationInput(session, shadowedSeqs) {
\tconst header = session.requestHeader();
\tconst head = systemHead(session, session.surface.nodes[0]);
\tconst system = head === void 0 ? null : session.deriveEventMessage(head);
\tconst region = shadowedSeqs.map((seq) => {
\t\tconst event = session.eventAt(seq);
\t\treturn { seq, message: session.deriveEventMessage(event), nativeRole: event.type.split("/")[0] };
\t});
\tconst visible = region.filter((entry) => entry.message !== null);
\tconst regionMessages = visible.map((entry) => entry.message);
\treturn Object.defineProperty({
\t\t...header?.tools === void 0 ? {} : { tools: header.tools },
\t\tmessages: system === null ? regionMessages : [system, ...regionMessages]
\t}, "nativeSpan", { value: deepFreeze({
\t\tshadowedSeqs: [...shadowedSeqs], startSeq: shadowedSeqs[0], endSeq: shadowedSeqs.at(-1),
\t\t...head === void 0 ? {} : { systemHeadSeq: head.seq },
\t\tmessageSeqs: system === null ? visible.map((entry) => entry.seq) : [head.seq, ...visible.map((entry) => entry.seq)],
\t\temptyNodes: region.filter((entry) => entry.message === null).map(({ seq, nativeRole }) => ({ seq, nativeRole }))
\t}) });
}`;

export const COMPACTION_TARGET_PATCH = Object.freeze({
  artifact: '@deepseek-ai/dsh-compaction-basic/lib/index.js',
  originalSha: 'b7ac52f20a36430cf01a66b3a36f23a48ffdb22708d714dbe1fff541b5df4ec5',
  patchedSha: '9be38a8a43310ca91cc7a10672b4c61a19d7e587aa5df51ce74d37462fbbdf47',
  before, after, spanBefore, spanAfter,
});
const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Price pending, already validated model selections without changing a request header. */
export function patchCompactionTarget(source: string): string {
  if (sha(source) === COMPACTION_TARGET_PATCH.patchedSha) return source;
  if (sha(source) === '1f61d1f836fe3695cf57e4b9518db88c6bb9dea196e51dd769f8899d097e736a') source = source.replace(after, before);
  if (sha(source) !== COMPACTION_TARGET_PATCH.originalSha) throw new Error('Unknown DSH compaction artifact; review pending model pressure routing');
  if (source.split(before).length !== 2) throw new Error('DSH compaction target anchor changed');
  if (source.split(spanBefore).length !== 2) throw new Error('DSH compaction span anchor changed');
  const patched = source.replace(before, after).replace(spanBefore, spanAfter);
  if (sha(patched) !== COMPACTION_TARGET_PATCH.patchedSha) throw new Error('DSH compaction target patch digest mismatch');
  return patched;
}

export function applyCompactionTargetPatch(): void {
  const file = fileURLToPath(new URL(`../node_modules/${COMPACTION_TARGET_PATCH.artifact}`, import.meta.url));
  const source = readFileSync(file, 'utf8'), patched = patchCompactionTarget(source);
  if (source !== patched) writeFileSync(file, patched);
  console.log('Verified DSH compaction pending model routing and native span patch');
}
