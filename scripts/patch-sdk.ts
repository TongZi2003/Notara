import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './patch-layout.ts';
import './patch-sidebar.ts';
import './patch-steering-display.ts';

const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(project, 'node_modules/@deepseek-ai/dsh-typert-generator/lib/index.js');
const original = "06a187cfc6c7e12eb88d260dc7a5d09029159a17cf9a9a54bea4e27939d0b009";
const patched = "59f8200e082408255a5dd64d78850b69890c288f0a85d531ad379db9f697247e";
const before = "\t\tif (this.registrationForFile(declaration.getSourceFile().fileName)?.name === \"@deepseek-ai/dsh-typert-protocol\") return true;";
const after = "\t\tif (this.registrationForFile(declaration.getSourceFile().fileName)?.name === \"@deepseek-ai/dsh-typert-protocol\") return true;\n\t\tif (externalModuleIdentityForFile(declaration.getSourceFile().fileName)?.package === \"@deepseek-ai/dsh-typert-protocol\") return true;";
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const source = readFileSync(file, 'utf8');
const digest = sha(source);
if (digest !== patched) {
  if (digest !== original) throw new Error('Unknown DSH generator artifact; review the version before patching');
  const result = source.replace(before, after);
  if (sha(result) !== patched) throw new Error('DSH generator patch digest mismatch');
  writeFileSync(file, result);
}
console.log('Verified rc.2 generator npm-declaration fix');

// The published subagent entry loads projection value types but omits their
// corresponding state augmentations from its declaration graph. TS6 then
// rejects SessionProjectionRegistry.register itself. Import the package's own
// declarations; do not duplicate SDK types or change executable runtime code.
const subagentFile = join(project, 'node_modules/@deepseek-ai/dsh-subagent/lib/types/index.d.ts');
const subagentOriginal = '069745a90031d6f5fa77250da37a062ecf1d76d5b4cce46ac602d6549fa9e0ec';
const subagentPatched = 'f5916c9aa816edab64a756af3f164319fa0e7d9eb4c85ddf04067acf9f7ebb91';
const subagentSource = readFileSync(subagentFile, 'utf8');
if (sha(subagentSource) !== subagentPatched) {
  if (sha(subagentSource) !== subagentOriginal) throw new Error('Unknown DSH subagent declaration; review the version before patching');
  const result = 'import type {} from "./projection.ts";\nimport type {} from "./catalog.ts";\n' + subagentSource;
  if (sha(result) !== subagentPatched) throw new Error('DSH subagent declaration patch digest mismatch');
  writeFileSync(subagentFile, result);
}
console.log('Verified rc.2 subagent projection declaration imports');

// rc.2 cold session/list uses only persisted projection hints. An idle rename
// is already in the native log, but the throttled hint may retain its old title
// across a restart. Checkpoint the native cache before acknowledging rename;
// cache.write also flushes the log. Keep the native title as the only authority.
const sessionApiFile = join(project, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js');
const sessionApiOriginal = '16ecb48f33996efe72868f1603223214430634c5ac4c3e8fe9060bf240e990ff';
const sessionApiPatched = '99f88cae48c9abc7ccd1c068a2dcdc984f559e70011bf3ad71a553a3d7379d80';
const sessionApiSource = readFileSync(sessionApiFile, 'utf8');
if (sha(sessionApiSource) !== sessionApiPatched) {
  if (sha(sessionApiSource) !== sessionApiOriginal) throw new Error('Unknown DSH Session API artifact; review rename checkpoint fix');
  const beforeRename = '\t\t\tconst accepted = titles.rename(agent.session, request.title);';
  const result = sessionApiSource.replace(beforeRename, beforeRename + '\n\t\t\tconst cache = this.ctx.get("sessionProjectionCache");\n\t\t\tif (cache === void 0) await this.ctx.sessions.flush(agent.session);\n\t\t\telse await cache.write(agent.session);');
  if (sha(result) !== sessionApiPatched) throw new Error('DSH rename checkpoint patch digest mismatch');
  writeFileSync(sessionApiFile, result);
}
console.log('Verified rc.2 native rename projection checkpoint');

// rc.2 paints the expanded model serialization as its optimistic user echo.
// Carry the captured editor text separately through the existing native sink.
// Admission, request identity, attachments, cancellation and recovery stay native.
const inputFile = join(project, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js');
const inputOriginal = '81314dfd95864f2522f8edb812e3f8e08b04a8ef2141913e6e8cbdaae1ffc37f';
const inputPendingPatched = 'a52d95fd35a71d1244fd34f3470cefbaf6414640c87ddc0442f2baeb1ee259f4';
const inputDockPatched = '8963925948b55e88e636018441dd43651649005710719cc7e2bfd9d500740229';
const inputPatched = '677c5fa3788255531d3655917fafc2f55077ad7803d4da10cda7739c68f873cf';
const inputSource = readFileSync(inputFile, 'utf8');
if (sha(inputSource) !== inputPatched) {
  if (![inputOriginal, inputPendingPatched, inputDockPatched].includes(sha(inputSource))) throw new Error('Unknown DSH native input artifact');
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
  // rc.2 locale namespaces have one owner and no overlay API. Keep the native
  // editor and its blocking/error placeholders; localize only ordinary prompts.
  ['"placeholder.hero": "描述你想要构建的内容, / 调用指令, @ 文件或对话"', '"placeholder.hero": "写下你想学习的内容…"'],
  ['"placeholder.default": "发消息或创建任务, / 调用指令, @ 文件或对话"', '"placeholder.default": "写下你想学习的内容…"'],
  ['"placeholder.hero": "Describe what you want to build, / commands, @ files or sessions"', '"placeholder.hero": "写下你想学习的内容…"'],
  ['"placeholder.default": "Message or run a task, / commands, @ files or sessions"', '"placeholder.default": "写下你想学习的内容…"']
]) result = result.replace(before!, after!);
  if (sha(result) !== inputPatched) throw new Error('DSH native pending display patch digest mismatch');
  writeFileSync(inputFile, result);
}
console.log('Verified rc.2 native reference pending display');
