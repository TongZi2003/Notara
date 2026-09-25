# Controlled Board Interactive Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Native Vault 课堂白板中加入第一版受控数学互动块，让老师的流式 Markdown 板书可以在指定区域显示可操作的抛物线场景，并支持展开、保存、静态导出和带入对话。

**Architecture:** 板书 Markdown 只保存 `interactive` 引用和布局；Host 为当前课堂保存独立的结构化互动文档，并通过 revision/CAS 读写。客户端通过内置 `math` provider 渲染紧凑预览和展开工作区，禁止执行板书正文中的任意 HTML。第一版实现 `parabola` 场景，provider 合同为后续圆锥曲线和几何场景保留扩展点。

**Tech Stack:** Native Vault JavaScript/TypeScript、React 18、SVG、原生 Node test、Playwright、Native Vault Remote 和 session event source。

## Global Constraints

- Native Vault 当前包版本保持 `0.16.17`；Node 下限保持 `>=24.0.0`。
- 课堂白板必须继续绑定真实 `sessionId` 和已登记 workspace；不创建第二套课堂生命周期。
- 白板正文不执行任意 HTML、JavaScript、iframe、外部 URL 或模型提供的代码。
- 互动文档由 Host 生成身份、路径、时间和 revision；模型不能填写这些字段。
- 所有互动场景写入使用 session 绑定和 CAS；冲突或部分失败不得显示成功状态。
- 默认课堂不重新启用实验数学插件；第一版 provider 内置于 Native Vault client/runtime。
- 保留用户当前工作树中的无关修改；只修改本计划列出的文件和必要的构建产物。
- 不实现星图；星图只保留设计文档，不进入本次实现。

---

## 文件边界

### 新增

- `examples/native-vault/interactive-data.js`：纯函数场景合同、provider/preset 白名单、场景校验和静态摘要。
- `examples/native-vault/interactive-data.test.js`：场景校验、边界和摘要测试。
- `examples/native-vault/interactive-runtime.js`：session 绑定的互动文档路径、读写、创建、CAS 更新和板书引用同步。
- `examples/native-vault/interactive-runtime.test.js`：临时 Vault、外部课堂隔离和 revision 冲突测试。
- `examples/native-vault/interactive-math-client.js`：内置数学 provider 的 SVG 绘制、参数映射、紧凑/展开视图和交互动作。
- `examples/native-vault/interactive-math-client.test.js`：纯数学映射、参数边界和场景摘要测试。

### 修改

- `examples/native-vault/board-data.js`：板书块解析、渲染和 `interactive` 引用校验。
- `examples/native-vault/board-runtime.js`：板书投影 hydration、互动块创建和互动更新。
- `examples/native-vault/board-render.js`：互动块静态导出快照。
- `examples/native-vault/board-client.js`：内嵌互动块、展开层、保存状态和错误状态。
- `examples/native-vault/board-client.css`：手绘手抄报风格的互动块和展开工作区。
- `examples/native-vault/agent-tools.js`：`write_lesson_board.interactive` 参数及学生可见约束。
- `examples/native-vault/remote-client.js`：`mutateBoardInteraction` Remote 方法。
- `examples/native-vault/index.js`：注册互动读取/更新的 Host Remote 门面。
- `examples/native-vault/workspace-client.js`：向白板传递“带入对话”回调。
- `examples/native-vault/client-source.ts`：注册互动 provider，建立互动块带入对话的输入框写入接缝。
- `examples/native-vault/board.test.js`：互动引用与白板导出回归。
- `tests/e2e/native-vault-minimal.spec.ts`：真实课堂白板互动流程和控制台错误断言。
- `examples/native-vault/package.json`：版本从 `0.16.17` 提升到 `0.16.18` 后重新构建 Native Vault。

### 构建产物

- `examples/native-vault/client.js`：只由 `npm run build:native-vault` 生成，不手工编辑。

---

### Task 1: 建立受控数学场景合同

**Files:**

- Create: `examples/native-vault/interactive-data.js`
- Test: `examples/native-vault/interactive-data.test.js`

**Interfaces:**

- Produces `INTERACTIVE_PROVIDERS`, `INTERACTIVE_PRESETS`, `validateInteractiveRef(value)`, `validateMathScene(value)`, `mathSceneSummary(scene)`。
- `validateMathScene` 返回规范化场景：`{ kind:'math', preset:'parabola', viewport:[-5,5,5,-5], parameters:{a,h,k}, observation }`。

- [ ] **Step 1: 写失败测试**

```js
test('accepts a bounded parabola scene and normalizes defaults', () => {
  const scene = validateMathScene({ preset: 'parabola', parameters: { a: 0.8 } });
  assert.deepEqual(scene, {
    kind: 'math', preset: 'parabola', viewport: [-5, 5, 5, -5],
    parameters: { a: 0.8, h: 0, k: 0 }, observation: ''
  });
});

test('rejects arbitrary HTML, scripts, external URLs and invalid parameters', () => {
  assert.throws(() => validateMathScene({ preset: 'parabola', html: '<script>1</script>' }), /interactive_scene_invalid/);
  assert.throws(() => validateMathScene({ preset: 'parabola', parameters: { a: 0 } }), /interactive_scene_invalid/);
  assert.throws(() => validateMathScene({ preset: 'parabola', parameters: { a: 4 } }), /interactive_scene_invalid/);
});

test('rejects an interaction reference with a non-whitelisted provider', () => {
  assert.throws(() => validateInteractiveRef({ provider: 'html', interactionId: 'x', revision: 0, preset: 'parabola' }), /interactive_ref_invalid/);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test examples/native-vault/interactive-data.test.js`
Expected: FAIL，因为 `interactive-data.js` 尚不存在。

- [ ] **Step 3: 实现最小合同**

实现严格白名单：`provider === 'math'`、`preset === 'parabola'`；`a` 范围 `0.1..3`，`h/k` 范围 `-10..10`，`observation` 最多 1200 字符；任何额外字段、HTML 字段、URL 字段和数组越界都抛出 `interactive_scene_invalid`。引用 ID 只接受 Host 生成的 UUID 形式，revision 必须是非负整数。

- [ ] **Step 4: 运行通过测试**

Run: `node --test examples/native-vault/interactive-data.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add examples/native-vault/interactive-data.js examples/native-vault/interactive-data.test.js
git commit -m "feat: add controlled interactive scene contract"
```

### Task 2: 接入 session 绑定互动文档和 CAS

**Files:**

- Create: `examples/native-vault/interactive-runtime.js`
- Test: `examples/native-vault/interactive-runtime.test.js`
- Modify: `examples/native-vault/board-data.js`
- Modify: `examples/native-vault/board-runtime.js`
- Test: `examples/native-vault/board.test.js`

**Interfaces:**

- Produces `interactionPath(sessionId, interactionId)`, `createInteractionRuntime(service)`。
- Runtime methods：
  - `read({sessionId, interactionId}) -> {revision, ref, scene}`
  - `create({sessionId, scene}) -> {ref, revision, scene}`
  - `mutate({sessionId, interactionId, expectedRevision, patch}) -> {ref, revision, scene}`
- Board blocks gain optional `interactive: { provider, interactionId, revision, preset }`。
- `board()` returns hydrated `block.interactionScene` only after Host validates and reads the same session-bound document。

- [ ] **Step 1: 写失败测试**

```js
test('creates and reopens an interaction only inside its owning classroom', async () => {
  const first = await runtime.create({ sessionId: 'lesson-a', scene: parabola() });
  assert.equal((await runtime.read({ sessionId: 'lesson-a', interactionId: first.ref.interactionId })).scene.parameters.a, 0.8);
  await assert.rejects(runtime.read({ sessionId: 'lesson-b', interactionId: first.ref.interactionId }), /interaction_binding_invalid/);
});

test('rejects a stale interaction revision without overwriting the current scene', async () => {
  const first = await runtime.create({ sessionId: 'lesson-a', scene: parabola() });
  const current = await runtime.mutate({ sessionId: 'lesson-a', interactionId: first.ref.interactionId, expectedRevision: 0, patch: { parameters: { a: 1.2 } } });
  await assert.rejects(runtime.mutate({ sessionId: 'lesson-a', interactionId: first.ref.interactionId, expectedRevision: 0, patch: { parameters: { a: 0.4 } } }), /vault_revision_conflict/);
  assert.equal((await runtime.read({ sessionId: 'lesson-a', interactionId: first.ref.interactionId })).revision, current.revision);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test examples/native-vault/interactive-runtime.test.js examples/native-vault/board.test.js`
Expected: FAIL，因为互动路径、读写和板书引用尚未存在。

- [ ] **Step 3: 实现 session 绑定 runtime**

使用 `lesson-interaction/<sha256(sessionId).slice(0,32)>/<interactionId>.json`，文件内容包含 `type:'lesson-interaction'`、session、provider、preset 和 scene。读写统一经过现有 `createAgentVaultIO`/editor，期望 revision 不匹配时返回 `vault_revision_conflict`。板书 marker 只保存引用，不保存 HTML 或脚本。互动更新完成后同步 marker 的 revision，任一步失败都返回错误，不生成学生可见成功状态。

- [ ] **Step 4: 扩展板书解析与投影**

让 `parseBoard` 校验 marker 的 `interactive` 字段；`renderBoard` 保留引用；`upsertBoard` 接受由 Host 生成的引用；`projectBoard` 继续只根据正文引用构造知识视图。给 `board()` 增加 hydration：不存在或失效的互动文档返回 `interactiveState:'unavailable'`，不得伪造空场景。

- [ ] **Step 5: 运行通过测试**

Run: `node --test examples/native-vault/interactive-runtime.test.js examples/native-vault/board.test.js`
Expected: PASS，且既有板书、来源投影和 CAS 测试保持通过。

- [ ] **Step 6: 提交**

```bash
git add examples/native-vault/interactive-runtime.js examples/native-vault/interactive-runtime.test.js examples/native-vault/board-data.js examples/native-vault/board-runtime.js examples/native-vault/board.test.js
git commit -m "feat: persist session-bound board interactions"
```

### Task 3: 扩展老师工具和 Remote 门面

**Files:**

- Modify: `examples/native-vault/agent-tools.js`
- Modify: `examples/native-vault/teaching-runtime.js`
- Modify: `examples/native-vault/index.js`
- Modify: `examples/native-vault/remote-client.js`
- Test: `examples/native-vault/agent-tools.test.js`
- Test: `examples/native-vault/remote-scope.test.js`

**Interfaces:**

- `write_lesson_board` gains optional:

```js
interactive: {
  provider: 'math',
  preset: 'parabola',
  scene: { preset: 'parabola', parameters: { a, h, k }, observation }
}
```

- Remote adds `mutateBoardInteraction({ sessionId, boardRevision, interactionId, interactionRevision, patch })`。

- [ ] **Step 1: 写失败测试**

```js
test('teacher board tool accepts a controlled interactive scene but rejects raw HTML', async () => {
  const contract = VAULT_TOOL_CONTRACTS.find(item => item.name === 'write_lesson_board');
  assert.ok(contract.parameters.properties.interactive);
  assert.equal(contract.parameters.properties.interactive.properties.provider.enum[0], 'math');
  assert.throws(() => validateMathScene({ preset: 'parabola', html: '<svg/>' }), /interactive_scene_invalid/);
});

test('remote facade exposes the interaction mutation method', () => {
  assert.ok(VAULT_REMOTE_METHODS.includes('mutateBoardInteraction'));
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test examples/native-vault/agent-tools.test.js examples/native-vault/remote-scope.test.js`
Expected: FAIL，因为 tool schema 和 Remote 方法还没有互动字段。

- [ ] **Step 3: 实现 Host tool 接线**

在 `write_lesson_board` 中让 Host 生成 interaction ID，先验证 scene，再创建/更新互动文档，最后调用 `upsertBoard` 写入引用。模型不接触路径、ID 或 revision。为 Host 注册 `mutateBoardInteraction`，按 session、board revision 和 interaction revision 双重校验。

- [ ] **Step 4: 运行通过测试**

Run: `node --test examples/native-vault/agent-tools.test.js examples/native-vault/remote-scope.test.js examples/native-vault/board.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add examples/native-vault/agent-tools.js examples/native-vault/teaching-runtime.js examples/native-vault/index.js examples/native-vault/remote-client.js examples/native-vault/agent-tools.test.js examples/native-vault/remote-scope.test.js
git commit -m "feat: expose controlled board interaction writes"
```

### Task 4: 实现手绘风格数学 provider

**Files:**

- Create: `examples/native-vault/interactive-math-client.js`
- Create: `examples/native-vault/interactive-math-client.test.js`
- Modify: `examples/native-vault/board-client.css`

**Interfaces:**

- `normalizeMathScene(scene) -> scene`
- `parabolaPath(scene, box) -> string`
- `scenePointFromPointer(scene, box, clientPoint) -> {h,k}`
- `createMathInteractive(React, options) -> React element`

- [ ] **Step 1: 写失败测试**

```js
test('maps the same scene into compact and expanded SVG without changing its values', () => {
  const scene = normalizeMathScene({ preset:'parabola', parameters:{ a:0.8, h:1, k:-1 } });
  assert.match(parabolaPath(scene, { width: 340, height: 210 }), /^M/);
  assert.match(parabolaPath(scene, { width: 720, height: 430 }), /^M/);
  assert.equal(scene.parameters.h, 1);
});

test('pointer mapping clamps the vertex to the scene viewport', () => {
  assert.deepEqual(scenePointFromPointer(parabola(), { width:340, height:210 }, { x:-99, y:999 }), { h:-5, k:-5 });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test examples/native-vault/interactive-math-client.test.js`
Expected: FAIL，因为 provider 函数尚未存在。

- [ ] **Step 3: 实现紧凑视图**

使用 SVG 绘制坐标网格、抛物线、顶点和焦点；内嵌状态只显示曲线、当前 `a`、当前观察和“展开互动图”。控件使用手绘纸张、蓝色线条、彩色高亮和轻微不规则边框，沿用 `board-client.css` 的变量，不引入外部 iframe 或第三方网络资源。

- [ ] **Step 4: 实现展开视图和动作**

展开视图增加参数滑杆、顶点拖动、观察文本编辑、“保存观察”和“带入对话”按钮。动作只产生结构化 scene patch；provider 不执行用户或模型提供的代码。保存由父级 Board 组件统一调用 Remote。

- [ ] **Step 5: 运行通过测试**

Run: `node --test examples/native-vault/interactive-math-client.test.js`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add examples/native-vault/interactive-math-client.js examples/native-vault/interactive-math-client.test.js examples/native-vault/board-client.css
git commit -m "feat: render hand-drawn parabola interaction"
```

### Task 5: 把互动块接入白板、展开层和对话输入

**Files:**

- Modify: `examples/native-vault/board-client.js`
- Modify: `examples/native-vault/workspace-client.js`
- Modify: `examples/native-vault/client-source.ts`
- Modify: `examples/native-vault/board-render.js`
- Test: `examples/native-vault/board.test.js`

**Interfaces:**

- `Board` accepts `onDiscuss?: (text: string) => boolean`。
- `createVaultWorkspace` accepts `onDiscuss` and passes the session-scoped callback to `Board`。
- Static export renders an interaction snapshot: equation, preset, current parameters and observation; it never emits a script or iframe。

- [ ] **Step 1: 写失败测试**

```js
test('interactive board export is a static snapshot and contains no executable HTML', () => {
  const board = { blocks: [{ title:'抛物线', kind:'note', body:'观察开口变化', interactiveScene: parabola() }] };
  const output = exportBoard(board).html;
  assert.match(output, /y = 0\.8\(x - 0\)²/);
  assert.doesNotMatch(output, /<script|<iframe|javascript:/i);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test examples/native-vault/board.test.js`
Expected: FAIL，因为导出器还不会渲染互动快照。

- [ ] **Step 3: 接入 Board 状态和 provider**

在 `Block` 中先渲染安全 Markdown，再在正文后挂载 `createMathInteractive`。`Board` 维护 `expandedInteraction`、当前场景和保存状态；互动 patch 乐观更新同一 block，保存中显示“正在保存互动图”，失败时保留旧场景并显示错误。展开层复用同一场景对象，不创建第二份文档。

- [ ] **Step 4: 接入对话输入**

在 `client-source.ts` 增加 `insertBoardObservation(ctx, sessionId, text, openView)`，复用原生 `ctx.conversation.input.for(scope)` 和 `slash/input-insert-text`，只填入观察文本并打开同一课堂对话，不自动发送。`workspace-client.js` 将它作为 `onDiscuss` 传入白板。

- [ ] **Step 5: 实现静态导出**

让 `exportBoard` 对互动块生成静态 SVG/公式和参数说明；Markdown 导出保留标题、参数和观察文本。导出内容不包含 provider 运行时代码、脚本、iframe 或外部资源。

- [ ] **Step 6: 运行通过测试**

Run: `node --test examples/native-vault/board.test.js examples/native-vault/interactive-math-client.test.js`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add examples/native-vault/board-client.js examples/native-vault/workspace-client.js examples/native-vault/client-source.ts examples/native-vault/board-render.js examples/native-vault/board.test.js
git commit -m "feat: embed controlled interactions in lesson board"
```

### Task 6: 构建、集成验证和真实浏览器验收

**Files:**

- Modify: `examples/native-vault/package.json`
- Modify: `examples/native-vault/client.js` via build only
- Modify: `tests/e2e/native-vault-minimal.spec.ts`
- Create: `docs/dev-log/2026-09-25-controlled-board-interactive-blocks.md`

- [ ] **Step 1: 写失败的浏览器场景**

在 `native-vault-minimal.spec.ts` 中增加真实流程：通过 Host/测试 fixture 创建一个含 `write_lesson_board.interactive` 的课堂板书，打开课堂白板，断言“受控互动块”和“展开互动图”可见；调整 `a` 后断言曲线和参数更新；点击展开、修改顶点、关闭后断言板书仍显示最新场景；点击“带入对话”后断言唯一 composer 出现观察文本。

- [ ] **Step 2: 运行失败场景**

Run: `npm run test:e2e -- tests/e2e/native-vault-minimal.spec.ts`
Expected: FAIL，直到 Native Vault client 接入 provider。

- [ ] **Step 3: 提升 Native Vault 补丁版本并构建**

将 `examples/native-vault/package.json` 版本提升一个补丁版本，运行：

```bash
npm run build:native-vault
```

确认 `examples/native-vault/client.js` 只由构建生成，且构建没有产生未打包 artifact。

- [ ] **Step 4: 运行确定性验证**

```bash
node --test examples/native-vault/interactive-data.test.js examples/native-vault/interactive-runtime.test.js examples/native-vault/interactive-math-client.test.js examples/native-vault/board.test.js
npm run build:native-vault
npm run test:e2e -- tests/e2e/native-vault-minimal.spec.ts
git diff --check
```

Expected：纯逻辑测试、Native Vault 构建和目标浏览器流程 PASS；控制台错误数组为空。

- [ ] **Step 5: 记录验证**

在 `docs/dev-log/2026-09-25-controlled-board-interactive-blocks.md` 记录目标、文件锚点、每层命令和 PASS/FAIL/BLOCKED 状态，注明星图未实现。

- [ ] **Step 6: 提交**

```bash
git add examples/native-vault/package.json examples/native-vault/client.js tests/e2e/native-vault-minimal.spec.ts docs/dev-log/2026-09-25-controlled-board-interactive-blocks.md
git commit -m "test: verify controlled board interactions in Vault"
```

## Plan Self-Review

- Spec coverage：覆盖受控 provider、session/CAS、流式占位、紧凑预览、展开工作区、手绘风格、静态导出、带入对话、窄屏和真实浏览器验证；星图明确排除。
- Placeholder scan：本计划没有未完成标记或未定义的后续任务；第一版只实现 `parabola`，其余 provider 由白名单合同拒绝。
- Type consistency：`interactionId/revision/preset` 由 Task 1 定义并由 Task 2/3/5 复用；`mutateBoardInteraction` 的双 revision 参数在 Task 3 定义并由 Task 5 调用；`onDiscuss` 在 Task 5 同时定义 Workspace 入口和 Board 消费者。
- Verification boundary：单元测试验证合同和纯函数，集成测试验证真实临时文件/CAS，E2E 验证可见课堂行为；没有把构建结果当成交互验收。
