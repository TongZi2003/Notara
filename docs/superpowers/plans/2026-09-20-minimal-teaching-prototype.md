# Minimal Teaching Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default Notara classroom expose only the knowledge base, in-conversation roadmap, worldbook, read-only subagents, and full route planning while keeping board, rounds, and other experimental workbench code available but hidden.

**Architecture:** Keep all existing Host registrations and persistence contracts. Restrict the default model projection and student workspace at the disclosure boundary, using one shared allowlist for facade methods; route planning and classroom trace remain available. Keep experimental implementations testable through their existing integration tests without placing them in the default classroom.

**Tech Stack:** TypeScript, React, Zod facade schemas, Vitest, Playwright, Markdown documentation.

## Global Constraints

- Do not change `resources/teaching/` teaching behavior in this scope.
- Do not delete board, round, seminar, or plugin implementation code.
- Keep full route planning (`find/open/propose` route and plan methods) available.
- Keep subagents read-only in the default model surface; do not expose `delegate_problem`.
- Preserve existing source, version, confirmation, idempotency, and permission contracts.
- Verify from the modified checkout; do not treat the long-lived browser or service as evidence for the new build.

### Task 1: Define and apply the default model capability projection

**Files:**
- Modify: `packages/contracts/src/tool-facades.ts`
- Modify: `packages/host/src/tools/tool-disclosure.ts`
- Modify: `packages/host/src/tools/tool-facades.ts`
- Test: `tests/unit/tool-disclosure.test.ts`
- Test: `tests/integration/tool-schema-projection.test.ts`

**Interfaces:**
- Produces one shared default facade-method allowlist used by schema projection and method help text.
- Keeps `TOOL_FACADES` as the complete Host registry for execution and history compatibility.

- [ ] **Step 1: Add a shared default method allowlist.**

  Add a `DEFAULT_CLASSROOM_FACADE_METHODS` constant beside `TOOL_FACADES`. Include the learning, stage, classroom/worldbook, route-planning, and read-only delegation methods; omit the entire `board` and `round` groups and omit `delegate_problem`.

- [ ] **Step 2: Add a test for the allowlist boundary.**

  Extend `tests/unit/tool-disclosure.test.ts` to assert that the default method names contain route and stage methods, exclude `board`, `round`, and `delegate_problem`, and remain unique.

- [ ] **Step 3: Project facade schemas to the allowlist.**

  Make the classroom disclosure path copy each facade's `oneOf` branches using only the shared allowlist. Keep the full registered facade executable for compatibility, but ensure the provider-facing schema cannot describe an omitted branch.

- [ ] **Step 4: Project the static method catalogue with the same allowlist.**

  Make `facadeMethodText()` accept or use the same default projection so the prompt does not mention hidden board, round, or writable subagent methods.

- [ ] **Step 5: Update the integration assertions.**

  Change `tests/integration/tool-schema-projection.test.ts` to assert the projected default facade names and absence of hidden method branches. Keep the constant tool list assertion and schema-root validation.

- [ ] **Step 6: Run the focused checks.**

  Run:

  ```bash
  npm run test:unit -- tests/unit/tool-disclosure.test.ts
  npm run test:integration -- tests/integration/tool-schema-projection.test.ts
  ```

  Expected: both commands pass and the assembled schema contains no `board`, `round`, or `delegate_problem` branch.

### Task 2: Remove experimental views from the default classroom workspace

**Files:**
- Modify: `packages/client/src/classroom/workspace-layout.ts`
- Modify: `packages/client/src/classroom/LearningWorkspace.tsx`
- Modify: `packages/client/src/classroom/WorkbenchGuide.tsx`
- Modify: `tests/unit/workspace-layout.test.ts`
- Modify: `tests/e2e/teaching-rounds.spec.ts`

**Interfaces:**
- The default `VIEWS` becomes `chat`, `thoughts`, and `materials`.
- `RoundsPanel` and plugin workbench components remain in the source tree but are not reachable from the default view list.

- [ ] **Step 1: Add a failing default-view assertion.**

  Update `tests/unit/workspace-layout.test.ts` to assert that `VIEWS` equals `['chat', 'thoughts', 'materials']` and that the default layout tests no longer seed `rounds`.

- [ ] **Step 2: Remove rounds from the default view registry.**

  Remove `rounds` from `VIEWS` and from default labels/icon/render branches. Preserve the round component and Host code for experimental tests.

- [ ] **Step 3: Stop auto-inserting installed plugin workbenches.**

  Keep plugin choice discovery available to the plugin manager, but pass no plugin workbench into the default classroom `views` or empty-state guide. This prevents an installed board from silently becoming a classroom tab.

- [ ] **Step 4: Update the round UI acceptance.**

  Replace the default classroom E2E expectation of a `workspace-open-rounds` button with an assertion that the default classroom has no rounds view. Leave `tests/integration/teaching-rounds.test.ts` as the protocol-level coverage for the retained experimental implementation.

- [ ] **Step 5: Run the focused client checks.**

  Run:

  ```bash
  npm run test:unit -- tests/unit/workspace-layout.test.ts
  npm run test:e2e -- tests/e2e/teaching-rounds.spec.ts
  ```

  Expected: the workspace test passes and the browser confirms no default round or plugin workbench tab.

### Task 3: Align the documented default plugin set

**Files:**
- Modify: `examples/plugins/README.md`
- Modify: `docs/runtime/plugins.md`
- Modify: `docs/runtime/skills-and-tools.md`
- Modify: `docs/superpowers/specs/2026-09-20-minimal-teaching-prototype-design.md`

- [ ] **Step 1: Change the default plugin wording.**

  Describe worldbook/classroom as the default contextual extension. Mark math workbench, rounds/seminar, and other workbenches as experimental and retained for isolated tests.

- [ ] **Step 2: Align the tool-count and visibility wording.**

  State that the Host registry remains larger than the default model surface, and that route planning plus read-only delegation are part of the default surface.

- [ ] **Step 3: Run documentation consistency checks.**

  Run:

  ```bash
  git diff --check
  rg -n "日常环境|默认课堂|数学工作台|回合|delegate_problem|完整路线" examples/plugins/README.md docs/runtime docs/superpowers/specs/2026-09-20-minimal-teaching-prototype-design.md
  ```

  Expected: no document says math workbench or rounds are part of the default classroom.

### Task 4: Build and verify the reduced default surface

**Files:**
- No new source files.
- Evidence: `docs/dev-log/2026-09-20-最小教学原型.md`

- [ ] **Step 1: Build generated runtime output.**

  Run `npm run build`.

- [ ] **Step 2: Run contract and type checks.**

  Run `npm run check:contracts`, `npm run typecheck`, and `npm run typecheck:tests`.

- [ ] **Step 3: Run focused integration coverage.**

  Run `npm run test:integration -- tests/integration/teaching-rounds.test.ts tests/integration/native-route-binding.test.ts tests/integration/plan-target-skeleton.test.ts tests/integration/tool-schema-projection.test.ts`.

- [ ] **Step 4: Run the isolated browser smoke.**

  Start a fresh `scripts/dev-isolated.ts` instance, open a new classroom, and verify the visible workspace contains conversation, materials, and roadmap only. Verify route planning remains reachable from the existing course/route surface and the plugin page still lists retained plugins without exposing them as classroom tabs.

- [ ] **Step 5: Record evidence and commit the implementation.**

  Write `docs/dev-log/2026-09-20-最小教学原型.md` with changed anchors, commands, PASS/FAIL/BLOCKED status, and the remaining experimental surfaces. Commit the implementation with a focused message.

## Self-review

- The design spec's five retained capabilities map to Tasks 1–3; Task 4 verifies the combined result.
- No task changes teaching prompt content or claims automated teaching quality.
- Board, round, and other plugin code remain registered for compatibility but are removed from the default model/UI projection.
- Full route planning remains explicitly included in the allowlist and verification.
- No placeholder steps or unknown filenames are used in the implementation commands.
