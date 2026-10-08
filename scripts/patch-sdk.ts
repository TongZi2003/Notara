import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './patch-layout.ts';
import './patch-sidebar.ts';
import './patch-input-source-filter.ts';
import './patch-skill-menu.ts';
import './patch-tool-args.ts';
import './patch-session-extension.ts';
import './patch-windows-token-dacl.ts';
import './patch-storage-json.ts';
import './patch-student-ui.ts';
import { stripConversationSeams, applyConversationSeams } from './patch-conversation-views.ts';
import { applySidebarReadyPatch } from './patch-sidebar-ready.ts';
import { applyProductBrandingPatch } from './patch-product-branding.ts';
import { applyOpenCodeGoPatch } from './patch-opencode-go.ts';
import { applyModelDiscoveryPatch } from './patch-model-discovery.ts';
import { applyCompactionTargetPatch } from './patch-compaction-target.ts';
import { applyContextRequestPatch } from './patch-context-request.ts';

const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

applySidebarReadyPatch();
applyProductBrandingPatch();
applyOpenCodeGoPatch();
applyModelDiscoveryPatch();
applyCompactionTargetPatch();
applyContextRequestPatch();

// DSH 0.2.0 cold session/list still uses only persisted projection hints. An idle rename
// is already in the native log, but the throttled hint may retain its old title
// across a restart. Checkpoint the native cache before acknowledging rename;
// cache.write also flushes the log. Keep the native title as the only authority.
const sessionApiFile = join(project, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js');
const sessionApiOriginal = 'fb0f7b96130f595db20809eeb77a195b05f4a039f931d1e67692f1f74a4dd269';
const sessionApiPatched = 'ac063178b96fbecef47882827444ea0b44ed7417b5e027b0bdb8e564654a3744';
const sessionApiSource = readFileSync(sessionApiFile, 'utf8');
if (sha(sessionApiSource) !== sessionApiPatched) {
  if (sha(sessionApiSource) !== sessionApiOriginal) throw new Error('Unknown DSH Session API artifact; review rename checkpoint fix');
  const beforeRename = '\t\t\tconst accepted = titles.rename(agent.session, request.title);';
  const result = sessionApiSource.replace(beforeRename, beforeRename + '\n\t\t\tconst cache = this.ctx.get("sessionProjectionCache");\n\t\t\tif (cache === void 0) await this.ctx.sessions.flush(agent.session);\n\t\t\telse await cache.write(agent.session);');
  if (sha(result) !== sessionApiPatched) throw new Error('DSH rename checkpoint patch digest mismatch');
  writeFileSync(sessionApiFile, result);
}
console.log('Verified DSH native rename projection checkpoint');

// DSH 0.2.0 still paints the expanded model serialization as its optimistic user echo.
// Carry the captured editor text separately through the existing native sink.
// Admission, request identity, attachments, cancellation and recovery stay native.
const inputFile = join(project, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js');
const inputOriginal = '6a9cbe7c9977e35f753363dcf46dae4245d2b93e37c725a7966e562ebca326d4';
const inputPatched = 'd0d57935a3d4af01b47ffae18094a20883dd08f891d6d4b2f5ae254177794d6f';
const inputSource = stripConversationSeams(readFileSync(inputFile, 'utf8'));
if (sha(inputSource) !== inputPatched) {
  if (sha(inputSource) !== inputOriginal) throw new Error('Unknown DSH native input artifact');
  let result = inputSource;
  for (const [before, after] of [
  [
    "async sendSession(session, text, attachmentIds, mode, signal) {",
    "async sendSession(session, text, attachmentIds, mode, signal, displayText) {"
  ],
  [
    "const submission = session.beginSubmission({\n\t\t\t\t\tmode,\n\t\t\t\t\ttext,",
    "const submission = session.beginSubmission({\n\t\t\t\t\tmode,\n\t\t\t\t\ttext: displayText ?? text,"
  ],
  [
    "this.deps.defaultSink(out.trim(), attachmentIds, mode, attempt.signal)",
    "this.deps.defaultSink(out.trim(), attachmentIds, mode, attempt.signal, draft.trim())"
  ],
  [
    "defaultSink: (text, attachmentIds, mode, signal) => this.sink(session, text, attachmentIds, mode, signal)",
    "defaultSink: (text, attachmentIds, mode, signal, displayText) => this.sink(session, text, attachmentIds, mode, signal, displayText)"
  ],
  [
    "sink(session, text, attachmentIds, mode, signal) {",
    "sink(session, text, attachmentIds, mode, signal, displayText) {"
  ],
  [
    "this.conversation().sendSession(session, text, attachmentIds, mode, signal)",
    "this.conversation().sendSession(session, text, attachmentIds, mode, signal, displayText)"
  ],
  // The declared ambient dock belongs to every real session, including its
  // first unsent draft. No input or message lifecycle is changed here.
  [
    'variant === "composer" && input !== void 0 && sessionId !== void 0 ? renderSlot("conversation.composer.dock", {}) : null',
    'input !== void 0 && sessionId !== void 0 ? renderSlot("conversation.composer.dock", {}) : null'
  ],
  // DSH locale namespaces have one owner and no overlay API. Keep the native
  // editor and its blocking/error placeholders; localize only ordinary prompts.
  ['"placeholder.hero": "描述你想要构建的内容, / 调用指令, @ 文件或对话"', '"placeholder.hero": "写下你想学习的内容…"'],
  ['"placeholder.default": "发消息或创建任务, / 调用指令, @ 文件或对话"', '"placeholder.default": "写下你想学习的内容…"'],
  ['"placeholder.hero": "Describe what you want to build, / commands, @ files or sessions"', '"placeholder.hero": "写下你想学习的内容…"'],
  ['"placeholder.default": "Message or run a task, / commands, @ files or sessions"', '"placeholder.default": "写下你想学习的内容…"']
]) {
    if (result.split(before!).length !== 2) throw new Error('DSH native pending display anchor changed');
    result = result.replace(before!, after!);
  }
  if (sha(result) !== inputPatched) throw new Error('DSH native pending display patch digest mismatch');
  writeFileSync(inputFile, result);
}
console.log('Verified DSH native reference pending display');
applyConversationSeams();
