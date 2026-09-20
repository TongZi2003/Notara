# Native Vault Conversation View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将独立 `@notara/vault-native` 注册为 DSH 原生 Conversation View 的第三个标签，与 Chat 和 Trajectory 并列。

**Architecture:** 插件只注册 `conversation.view`，不再占用 `root` 或右侧 Sidebar。Vault 视图使用 DSH 的 `--dsw-*` 主题变量和 Session View 容器尺寸；本轮保留本地 demo 数据，后续再接 workspace Markdown Host。

**Tech Stack:** DSH Slots、React 18、原生 CSS token、Node syntax check、隔离 DSH Web 实例。

## Global Constraints

- 不加载 StudyForge Host/client、旧 RecordStore 或旧课堂 UI。
- 不注册 `root`、`sidebar.right.pane.tab` 或 `sidebarRightTabs`。
- 标签 id 使用稳定的 `notara-vault`，排序在原生 Chat 与 Trajectory 之后。
- 页面必须继承 DSH 原生颜色、字体、边框和尺寸变量，不使用独立纸张主题。

### Task 1: Register the third native Conversation View

**Files:**
- Modify: `examples/native-vault/client.js`
- Modify: `examples/native-vault/package.json` only if a client injection is required

- [ ] Replace the right Sidebar registration with a `conversation.view` slot registration using `id: 'notara-vault'`, `order: 20`, and label `资产`.
- [ ] Keep the current Markdown demo behavior: file list, search, editor, preview and local persistence.
- [ ] Replace custom paper colors with `--dsw-alias-*`, `--dsw-specific-*`, and `--dsw-font-family` tokens; make the root fill the native View container.
- [ ] Run `node --check examples/native-vault/client.js`.

### Task 2: Verify native tab coexistence

**Files:**
- Modify: `docs/dev-log/2026-09-20-notara-vault-mapping.md` only if the native View boundary needs a factual update

- [ ] Start `scripts/dev-native-vault.ts` with Node 24 and a fresh isolated `DSH_HOME`.
- [ ] Confirm the native DSH header has `对话`, `轨迹`, and `资产` as sibling tabs.
- [ ] Confirm selecting `资产` does not hide the native session shell or replace `root`.
- [ ] Confirm switching back to `对话` preserves the native conversation page.
- [ ] Record the exact URL and evidence state; do not use the old main Notara runtime.

### Completion criteria

The clean native DSH instance visibly shows three sibling session views, with Vault as the third item and native DSH theme styling. The old Sidebar/root implementation is absent.
