# Notara 轻量教学与 ThoughtMap 阶段框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 DSH 原生课堂、资料写者和 ThoughtGraph 上补齐轻量 Markdown 共建与显式对话阶段框，保持单一 Session、单一资料身份和可重放的 CAS 写入。

**Architecture:** ThoughtGraph 增加可选兼容的 `frames`，按原生消息 sequence 投影成员；`advance_conversation_stage` 在一个 RecordStore 更新中关闭当前 frame、写总结并创建新的 active frame，`mark_thought` 和读侧自动按边界归属。课堂 Markdown 直接复用 `MaterialService.import/createVersion`，只新增教师窄工具和学生资料页直编辑，不创建 ConversationPlan、第二 Session 或新的教材实体。

**Tech Stack:** TypeScript 6.0.3、Zod 4、Vitest、Playwright、DSH 0.1.5-rc.2、React 18、原生 `sessionQuery/sessionController`、`RecordStore`、现有 MaterialService。

## Global Constraints

- 保持 DSH `0.1.5-rc.2`、Node `>=24`、TS `6.0.3`、cordis `4.0.2`，锁文件是唯一裁判。
- 只在 `<DSH仓库根目录>` 及本任务根文档写入；保留已有脏改动，不清理或回滚。
- 不启动、停止或重启共享服务；运行态只使用 `scripts/dev-isolated.ts` 的临时 `DSH_HOME` 与随机端口。
- 旧 ThoughtGraph 缺失 `frames` 时按空数组读取；旧 `event:*`/`stage:*` 节点不自动迁移。
- 阶段完成不表示掌握、复习、学情或课程结束；不新增 `route:tree` 节点和独立对话生命周期。
- Markdown 写回只能通过现有资料写者和版本/CAS；不伪造来源、身份、路径、时间戳或保存成功。
- 模型只提供标题、总结、下一目标和推进方式；Host 生成 frame ID、消息边界、版本、操作记录。

---

### Task 1: ThoughtGraph frame contract and pure projection

**Files:**
- Modify: `packages/contracts/src/classroom-trace.ts`
- Modify: `packages/host/src/thought-stages.ts`
- Create: `packages/host/src/conversation-frames.ts`
- Test: `tests/unit/conversation-frames.test.ts`

**Interfaces:**
- `ConversationFrameSchema`/`ConversationFrame` owns `id/title/goal/summary/mode/status/parentFrameId/resumeFrameId/startSequence/endSequence/operationIds`.
- `ThoughtGraphSchema` accepts `frames: []` by default and `ThoughtNodeSchema` accepts optional `frameId` for explicit sequence-less manual nodes.
- `projectConversationFrames(graph, nodes)` returns `{ frames, activeFrameId, unsegmented }`; automatic nodes satisfy `startSequence <= sequence < endSequence`, active frames have no upper boundary, and manual nodes without a frame remain unsegmented.

- [x] **Step 1: Write the failing contract and projection tests**

```ts
test('legacy graph reads with no frames and leaves event nodes unsegmented', () => {
  const graph = ThoughtGraphSchema.parse({ sessionId: 'lesson', nodes: [], edges: [], hidden: [] });
  expect(graph.frames).toEqual([]);
});

test('half-open sequence boundaries put later messages only in the active frame', () => {
  const graph = graphWithFrames([
    frame({ id: 'f1', startSequence: 2, endSequence: 5, status: 'completed' }),
    frame({ id: 'f2', startSequence: 5, status: 'active' }),
  ]);
  expect(projectConversationFrames(graph, [node(4), node(5), node(8)]).frames.map(f => f.nodes.map(n => n.sequence)))
    .toEqual([[4], [5, 8]]);
});

test('sequence-less manual nodes use explicit frameId and never get guessed', () => {
  const graph = graphWithFrames([frame({ id: 'f1', startSequence: 1, status: 'active' })]);
  expect(projectConversationFrames(graph, [manual({ id: 'm1', frameId: 'f1' }), manual({ id: 'm2' })]).unsegmented.map(n => n.id)).toEqual(['m2']);
});
```

- [x] **Step 2: Run the focused unit file and verify the expected red failure**

Run: `cd dsh && npm run test:unit -- tests/unit/conversation-frames.test.ts`

Expected: FAIL because the frame schema and `projectConversationFrames` do not yet exist.

- [x] **Step 3: Implement the minimum schema and projection**

```ts
export const ConversationFrameSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1).max(160), goal: z.string().trim().min(1).max(4000),
  summary: z.string().trim().max(4000).optional(), mode: z.enum(['root', 'continue', 'branch', 'resume']),
  status: z.enum(['active', 'completed', 'branched', 'paused']), parentFrameId: z.string().min(1).optional(),
  resumeFrameId: z.string().min(1).optional(), startSequence: z.number().int().nonnegative().optional(),
  endSequence: z.number().int().nonnegative().optional(), operationIds: z.array(z.string().min(1)),
}).strict();
export const ThoughtGraphSchema = z.object({ sessionId: z.string(), nodes: z.array(ThoughtNodeSchema).max(2000), edges: z.array(ThoughtEdgeSchema).max(5000), hidden: z.array(z.string()).default([]), frames: z.array(ConversationFrameSchema).max(200).default([]) }).strict();
```

The projector must sort frames by stored order, reject overlap and invalid relations, assign only one frame by the half-open rule, and expose a frame view with `nodes`; it must never mutate the original graph or create a frame.

- [x] **Step 4: Run the focused tests and typecheck the contracts**

Run: `cd dsh && npm run test:unit -- tests/unit/conversation-frames.test.ts && npm run typecheck`

Expected: all frame unit tests pass and the build reports exit code 0.

- [x] **Step 5: Include the contract/projection slice in the final commit**

```bash
git add packages/contracts/src/classroom-trace.ts packages/host/src/conversation-frames.ts packages/host/src/thought-stages.ts tests/unit/conversation-frames.test.ts
git commit -m "feat: add ThoughtMap conversation frame projection"
```

### Task 2: Atomic stage advancement and existing ThoughtMap integration

**Files:**
- Modify: `packages/host/src/classroom-trace-service.ts`
- Modify: `packages/host/src/thought-stages.ts`
- Modify: `packages/host/src/teaching/teaching-context.ts`
- Test: `tests/integration/classroom-trace.test.ts`

**Interfaces:**
- `StudyForgeTrace.read` returns legacy `nodes/stages/edges` plus `frames`, `activeFrameId`, and `unsegmented`; read has no write side effect.
- `StudyForgeTrace.advance(input: {sessionId; operationId; title; summary; nextGoal; mode?; parentFrameId?; resumeFrameId?})` performs one conditional RecordStore mutation and returns the updated `ClassroomTrace`.
- `studyforgeTrace/edit` accepts `frame` metadata edits and `node.frameId`; it may pause the active frame but cannot reopen a terminal frame or write learning/review state.
- New native tool `advance_conversation_stage` uses the teacher session context to provide `sessionId` and the Host generated `operationId`.

- [x] **Step 1: Add failing integration cases for root, continuation, branch, conflict and retry**

```ts
test('advance creates a root frame and later actual messages bind to it', async () => {
  const lesson = await openTeacher();
  const first = await rpc('advance_conversation_stage', { title: '界定问题', summary: '先确认研究对象。', nextGoal: '写出第一个判断' });
  expect(first.value.activeFrameId).toBe(first.value.frames[0].id);
  await prompt(lesson.sessionId, '对象是函数的变化率');
  expect((await readTrace(lesson.sessionId)).frames[0].nodes.some(n => n.body.includes('变化率'))).toBe(true);
});

test('same operationId replays without creating a second frame and stale CAS keeps old data', async () => {
  const input = { sessionId, operationId: 'advance-once', title: '阶段', summary: '总结', nextGoal: '下一步' };
  const first = await trace.advance(input);
  const replay = await trace.advance(input);
  expect(replay.version).toBe(first.version);
  expect(replay.frames).toHaveLength(first.frames.length);
});
```

- [x] **Step 2: Run the new integration cases and verify they fail for missing frame behavior**

Run: `cd dsh && npm run test:integration -- tests/integration/classroom-trace.test.ts`

Expected: FAIL at the new frame assertions while the existing node/fork assertions remain diagnostic.

- [x] **Step 3: Implement one CAS stage transition**

Read the current saved graph and native session's last own event sequence. If no active frame exists, create `mode: root`; otherwise set the current frame's `summary`, `endSequence = lastSequence + 1`, and status to `branched` for a branch or `completed` otherwise. Append a new frame with `startSequence = lastSequence + 1`, the requested goal, generated frame ID, relationship fields, and the operation ID. Use `create` at version zero and `update` with the saved version thereafter; on an existing operation ID return its stored result. The transform must return a full `ThoughtGraph` and leave `route:tree` untouched.

- [x] **Step 4: Bind nodes in `read`, extend edit, and register the narrow tool**

Keep `projectStages` only as the compatibility projection for old settled note stages. Do not turn a note save into a new frame. Update `mark_thought` to copy the active frame relationship only when it has an explicit sequence; sequence-less manual nodes use `frameId` supplied by an explicit edit. Register the tool with descriptions that say it closes the active frame, creates the next active frame, does not imply mastery, and does not create a route node. Add `advance_conversation_stage` to helper-forbidden teacher-only tools.

- [x] **Step 5: Run the focused integration test, typecheck and build**

Run: `cd dsh && npm run test:integration -- tests/integration/classroom-trace.test.ts && npm run typecheck && npm run build`

Expected: existing trace/fork behavior and all new frame cases pass; typecheck/build exit 0.

### Task 3: Classroom Markdown narrow writer and same-material versioning

**Files:**
- Create: `packages/contracts/src/classroom-markdown.ts`
- Modify: `packages/host/src/tools/material-tools.ts`
- Modify: `packages/host/src/materials/resource-service.ts`
- Modify: `packages/host/src/teaching/teaching-context.ts`
- Modify: `packages/client/src/materials/MaterialEditor.tsx`
- Modify: `packages/client/src/materials/MaterialsPage.tsx`
- Test: `tests/integration/classroom-markdown.test.ts`
- Test: `tests/unit/classroom-markdown-contract.test.ts`

**Interfaces:**
- `ClassroomMarkdownViewSchema` returns the real `materialId`, current `versionId`, material revision, title and decoded Markdown body; it never returns a local filesystem path.
- Native tools `create_markdown_material`, `read_markdown_material`, and `update_markdown_material` use `teacherContext`; create imports one Markdown material, read resolves one exact version, update calls `MaterialService.createVersion` with `expectedVersion`.
- Client editor continues to use `studyforgeMaterials.import/createVersion`, edits the current Markdown object directly, retains a draft on transport/CAS failure, and no longer opens a `studyforgeCreation` Session for Markdown coediting.

- [x] **Step 1: Write contract, writer and conflict tests first**

```ts
test('classroom markdown output contains one material identity and no path', () => {
  expect(ClassroomMarkdownViewSchema.parse({ ref: 'material:mat_1234567890abcdef', materialId: 'mat_1234567890abcdef', versionId: 'ver_1234567890abcdef', revision: 1, title: '变化率', content: '# 变化率' })).not.toHaveProperty('path');
});

test('AI creates, reads, appends a second version and stale update preserves the newer version', async () => {
  const first = await call('create_markdown_material', { title: '课堂讲义', content: '# 第一章' });
  const second = await call('update_markdown_material', { materialId: first.materialId, versionId: first.versionId, expectedVersion: first.revision, content: '# 第一章\n\n## 第二章' });
  expect(second.revision).toBe(2);
  expect((await callRaw('update_markdown_material', { materialId: first.materialId, versionId: first.versionId, expectedVersion: first.revision, content: '覆盖' })).ok).toBe(false);
  expect((await call('read_markdown_material', { materialId: first.materialId, versionId: second.versionId })).content).toContain('第二章');
});
```

- [x] **Step 2: Run focused tests and verify the expected red failure**

Run: `cd dsh && npm run test:unit -- tests/unit/classroom-markdown-contract.test.ts && npm run test:integration -- tests/integration/classroom-markdown.test.ts`

Expected: FAIL because the classroom Markdown schema and tool registrations are absent.

- [x] **Step 3: Implement the constrained tool contract over MaterialService**

Parse title/content/references with bounded lengths, derive a safe `.md` filename in Host code, and call `materialService.import({ ...teacherContext, operationId }, { title, fileName, mediaType: 'text/markdown', bytes })`. For read, validate `materialId/versionId`, resolve exact bytes and return decoded content. For update, validate current media type, call `createVersion` with the supplied `expectedVersion`, and return the new version. All exceptions surface as remote refusals; no success result is emitted before the material writer resolves.

- [x] **Step 4: Change student Markdown editing to append a version on the same material**

Keep the existing bytes decode, draft and latest-version conflict UI. Replace the “和 AI 共同编辑” action's `studyforgeCreation.create/openCreation` path with the direct material editor state. Preserve `materialId`, target version and `expectedVersion`; show the current Markdown preview and keep the original “回到课堂” navigation through the existing materials navigation. Do not change non-Markdown formats or the separate Creator workflow for skills, teaching, HTML and classroom artifacts.

- [x] **Step 5: Run writer tests, related regressions, typecheck and build**

Run: `cd dsh && npm run test:unit -- tests/unit/classroom-markdown-contract.test.ts && npm run test:integration -- tests/integration/classroom-markdown.test.ts tests/integration/creation-workspace.test.ts && npm run typecheck && npm run build`

Expected: direct Markdown creation/read/update and stale conflict pass; existing Creator and material-version tests pass.

### Task 4: Classroom teaching guidance, frame UI and browser/integration acceptance

**Files:**
- Modify: `dsh/resources/teaching/skills/studyforge-markdown-handout.md`
- Modify: `packages/client/src/classroom/ClassroomTrace.tsx`
- Modify: `packages/client/src/classroom/classroom-trace.css`
- Modify: `packages/client/src/client/index.tsx` only if the new Remote requires an explicit client injection
- Modify: `packages/host/src/teaching/teaching-context.ts`
- Test: `tests/e2e/notara-learning-authoring.spec.ts`
- Test: `tests/integration/classroom-trace.test.ts`

**Interfaces:**
- The ThoughtMap renders frame headers and their projected nodes; frame bounds are calculated from member node positions, with no persisted rectangle fact.
- Frame detail exposes goal, summary, status, parent/resume relation, counts and existing source/card/note/original-conversation actions.
- The classroom skill says empty-material lessons can start normally, ordinary learning does not trigger guided diagnosis, Markdown writes use the three narrow tools, and a save/stage result does not imply mastery.

- [x] **Step 1: Add failing browser assertions for the student-visible behavior**

```ts
test('empty classroom keeps one native conversation and Markdown editor stays in the materials workbench', async ({ page }) => {
  await openIsolatedStudent(page);
  await expect(page.getByTestId('learning-workspace')).toBeVisible();
  await expect(page.getByTestId('workspace-open-chat')).toBeVisible();
  await expect(page.getByTestId('workspace-open-materials')).toBeVisible();
  await expect(page.getByText('和 AI 共同编辑')).toHaveCount(0);
});

test('ThoughtMap shows the active frame and keeps stage completion separate from mastery', async ({ page }) => {
  await openLessonWithFrame(page);
  await expect(page.getByTestId('thought-frame')).toBeVisible();
  await expect(page.getByText(/目标/)).toBeVisible();
  await expect(page.getByText(/掌握|复习/)).toHaveCount(0);
});
```

- [x] **Step 2: Run the browser test to capture the expected red state**

Run: `cd dsh && npm run test:e2e -- tests/e2e/notara-learning-authoring.spec.ts`

Expected: FAIL only on the new frame/editor assertions before the UI changes.

- [x] **Step 3: Render frame groups without replacing native conversation**

Use `trace.frames` for the main map/list nodes, add a stable `data-testid="thought-frame"` wrapper and a compact header for title, goal, summary and status. Keep the current node detail, source navigation, original conversation jump, fork, edit and edge actions. Show `trace.unsegmented` in a separate “未分段” group. Do not render a second composer or expose internal IDs/paths in student copy.

- [x] **Step 4: Update teaching instructions and student copy**

Add procedural guidance: start from a topic/question/goal in the existing empty-material classroom; ask only the one starting-point question when needed; use `create_markdown_material` for a requested handout, `read_markdown_material` before edits, `update_markdown_material` with the real revision; save once a coherent unit is ready; continue the same object; call `advance_conversation_stage` only when the teacher has a real summary and next goal. Remove any guidance that routes Markdown through Creator or suggests save/phase means mastery.

- [x] **Step 5: Run focused proportional verification**

Run: `cd dsh && npm run check:contracts && npm run test:unit && npm run test:integration -- tests/integration/classroom-trace.test.ts tests/integration/classroom-markdown.test.ts tests/integration/creation-workspace.test.ts && npm run typecheck && npm run typecheck:tests && npm run build && npm run test:e2e -- tests/e2e/notara-learning-authoring.spec.ts`

Record each category separately as `PASS`, `FAIL`, `BLOCKED` or `未运行`; do not promote an isolated runtime or test-model run to real-model teaching quality.

### Task 5: Delivery audit, handoff and commit

**Files:**
- Create: `docs/dev-log/2026-09-15-Notara-lightweight-learning-and-thoughtmap-frames.md`
- Modify: `CLAUDE.md` only where current status, evidence or open items changed
- Modify: this plan's checkboxes as work completes

- [x] **Step 1: Re-read both specs and audit every acceptance row**

Mark the implemented frame, retry/conflict, legacy compatibility, route isolation, empty classroom, direct Markdown, refresh/reopen, source identity and classroom-tool isolation rows with actual command/browser evidence.

- [x] **Step 2: Write the development handoff**

Include goal, actual files/functions, persistent invariants, verification commands and results, known failures/blocked real-model gates, and the next executable entry point. Keep technical details in `docs/dev-log`, not in student-facing handoffs.

- [x] **Step 3: Update the current ledger only for changed state**

Add one concise current-state entry and one §七 index line for the new dev-log if the implementation or evidence changes the current status. Do not rewrite unrelated historical entries.

- [x] **Step 4: Verify the final diff and commit implementation plus docs**

```bash
git status --short
git diff --check
git diff --stat
git add packages tests docs AGENTS.md README.md
git commit -m "feat: add lightweight classroom authoring and thoughtmap frames"
git status --short --branch
```

The final report must include the commit hash, changed files, separate PASS/FAIL/BLOCKED/未运行 evidence, and preserved pre-existing worktree changes.
