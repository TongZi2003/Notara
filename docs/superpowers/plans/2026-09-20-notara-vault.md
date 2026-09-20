# Notara Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This plan is executed inline in the current session; no subagents are used.

**Goal:** Build the first native `@notara/vault` asset slice: safe Markdown files, parsed metadata and links, indexed search/query, versioned Host writes, and a canvas panel that can bring a selected file into the active conversation.

**Architecture:** Markdown files under the current StudyForge workspace's `vault/` directory are the only asset fact source. `VaultKernel` is a pure domain module for parsing and projections; `StudyForgeVault` owns filesystem, workspace binding, atomic writes and index refresh; `VaultPanel` is a native client workspace view. The old RecordStore course/card/route services remain outside this feature.

**Tech Stack:** TypeScript 6, Zod 4, React 18, DSH Typert Remote, Node `fs/promises`, Vitest, Playwright.

## Global Constraints

- Keep all `@deepseek-ai/dsh-*` versions on `0.1.5-rc.2`.
- Keep the vault root inside the current StudyForge workspace; never read `/Users/yangrundong/Documents/测试` from runtime code.
- Do not expose arbitrary JavaScript query execution or a second asset database.
- Host owns path, workspace/session binding, revision and timestamps; callers supply only relative paths and content.
- Student-facing errors must be readable Chinese; do not expose absolute paths, session IDs or tool protocol names.
- Run the relevant unit/integration/type/build checks from the modified checkout and record results in a dev-log.

### Task 1: Add vault contracts and pure kernel

**Files:**
- Create: `packages/contracts/src/vault.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json` to export `./vault`
- Create: `packages/domain/src/vault/vault-kernel.ts`
- Modify: `packages/domain/package.json` to export `./vault`
- Create: `tests/unit/vault-kernel.test.ts`
- Modify: `package.json` and `package-lock.json` only if a direct YAML dependency is required

**Interfaces:**

```ts
export const VaultPathSchema = z.string().trim().min(1).max(500).regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\0]+$/);
export const VaultListInputSchema = z.object({ prefix: z.string().trim().max(300).optional() }).strict();
export const VaultReadInputSchema = z.object({ path: VaultPathSchema }).strict();
export const VaultSaveInputSchema = z.object({ path: VaultPathSchema, content: z.string().max(1_000_000), expectedRevision: z.number().int().nonnegative() }).strict();
export const VaultSearchInputSchema = z.object({ query: z.string().trim().max(200), limit: z.number().int().positive().max(100).default(30) }).strict();
export const VaultQueryInputSchema = z.object({ where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}), limit: z.number().int().positive().max(100).default(100) }).strict();
export type VaultDocument = { path: string; revision: number; content: string; title: string; frontmatter: Record<string, unknown>; headings: string[]; tags: string[]; links: string[]; tasks: { checked: boolean; text: string }[] };
export type VaultSummary = Omit<VaultDocument, 'content'> & { size: number };
```

The kernel exports `safeRelativePath`, `parseMarkdownDocument(path, content, revision)`, `buildBacklinks(documents)`, `searchDocuments(documents, query, limit)`, `queryDocuments(documents, where, limit)`, `projectTree(summaries)`, and `revisionFor(content)`. Parse only frontmatter between the first two `---` lines, preserve unknown JSON-compatible values, extract headings, tags, checkboxes and `[[target]]` links, and normalize link targets to `.md`-free vault paths. `queryDocuments` compares only scalar frontmatter values and arrays containing a queried string.

- [ ] Write unit tests for frontmatter, headings/tags/tasks, wikilinks/backlinks, path traversal, search, query, tree and deterministic revision.
- [ ] Run `npm run test:unit -- tests/unit/vault-kernel.test.ts`; expected initial failure because the module is absent.
- [ ] Add the contract schemas and package exports.
- [ ] Implement the pure parser/index projections without filesystem access.
- [ ] Run the focused unit test and `npm run check:contracts`; expected PASS.
- [ ] Commit `feat: add vault contracts and markdown kernel`.

### Task 2: Add the Host Remote and workspace-scoped file store

**Files:**
- Create: `packages/host/src/vault-service.ts`
- Modify: `packages/host/src/index.ts`
- Create: `tests/integration/vault-service.test.ts`

**Interfaces:**

```ts
export class StudyForgeVault extends TypertRemoteService {
  constructor(ctx: Context);
  @Remote('list') list(input: VaultListInput): Promise<VaultSummary[]>;
  @Remote('read') read(input: VaultReadInput): Promise<VaultDocument | { ok: false; error: { code: string; message: string } }>;
  @Remote('save') save(input: VaultSaveInput): Promise<VaultDocument | { ok: false; error: { code: string; message: string } }>;
  @Remote('search') search(input: VaultSearchInput): Promise<VaultSearchResult>;
  @Remote('query') query(input: VaultQueryInput): Promise<VaultSummary[]>;
  @Remote('links') links(input: VaultReadInput): Promise<{ outgoing: string[]; incoming: string[] }>;
}
```

Use `join(studyforgeAccess.root, 'vault')`, `canonicalPath` and `studyforgeAccess` to reject absolute paths, traversal and non-Markdown files. On each operation, scan Markdown files recursively into an in-memory document map for that workspace. `read` returns an empty-not-found error for absent files. `save` creates parent directories, compares the supplied revision with the current content revision (zero for a new file), writes through a temporary sibling file followed by rename, and rescans before returning. Return `VAULT_REVISION_CONFLICT` with the current revision when stale; never overwrite stale content. `list` returns only summaries and `links` derives incoming links from the same scan.

- [ ] Write integration tests using a temporary workspace root for empty list, nested Markdown files, traversal refusal, read/parse, atomic save, revision conflict, search/query and backlinks.
- [ ] Run the focused integration test; expected failure before the Remote is registered.
- [ ] Register `StudyForgeVault` and the `studyforgeVault` Context declaration in `packages/host/src/index.ts`, with the vault directory created lazily.
- [ ] Implement scan, safe path resolution, revision checking and readable error mapping.
- [ ] Run `npm run build`, `npm run check:contracts` and the focused integration test; expected PASS.
- [ ] Commit `feat: expose workspace markdown vault remote`.

### Task 3: Add the native canvas vault view

**Files:**
- Create: `packages/client/src/vault/VaultPanel.tsx`
- Create: `packages/client/src/vault/vault.css`
- Modify: `packages/client/src/classroom/workspace-layout.ts`
- Modify: `packages/client/src/classroom/LearningWorkspace.tsx`
- Modify: `packages/client/src/client/index.tsx`
- Create: `tests/unit/vault-panel-model.test.ts` only for any extracted view-state helpers

The `vault` workspace view is a first-party view, included in `VIEWS` and labeled `资产`. It is available for the learning workspace without changing the default blank layout: a user opens it from the workspace bar and it docks beside chat. `VaultPanel` calls `ctx.remote.studyforgeVault.list/read/search/links/save`, keeps the selected document's draft and revision locally, and emits `studyforge:vault-changed` after a successful save. The panel contains:

```tsx
<aside data-testid="vault-panel">
  <input aria-label="搜索资产" />
  <nav data-testid="vault-tree" />
  <article data-testid="vault-document">
    <h1 /> <p data-testid="vault-frontmatter" /> <MarkdownBody />
    <textarea aria-label="编辑 Markdown" />
    <button>保存</button>
    <button>带入对话</button>
    <section data-testid="vault-backlinks" />
  </article>
</aside>
```

For “带入对话”, use `ctx.sessions.scope(sessionId as SessionId)` and `ctx.conversation.input.for(scope)`, then `insertReference({ source: 'notara-vault', ref: JSON.stringify({ path, revision }), label: title, clipboardText: '【' + title + '】' }, { start, end, draftRev })`. The codec can be added later; this first slice inserts a bounded readable reference marker plus current content excerpt and never inserts internal paths beyond the vault-relative title. Conflict keeps the textarea draft and displays `文件已变化，请刷新后再保存。`.

- [ ] Add `vault` to the workspace view type, labels, icon and view presets without changing the blank default tree.
- [ ] Implement the panel's list/read/search state and empty-vault state.
- [ ] Implement Markdown read view, metadata summary, backlinks and bounded editor.
- [ ] Implement save success refresh, conflict preservation and conversation insertion.
- [ ] Add scoped CSS matching the existing notebook workspace; do not add a new global sidebar.
- [ ] Run client typecheck/build and focused browser checks after the Host is running.
- [ ] Commit `feat: add native vault asset panel`.

### Task 4: Add the first plugin package and documentation

**Files:**
- Create: `examples/plugins/vault/package.json`
- Create: `examples/plugins/vault/README.md`
- Create: `examples/plugins/vault/skill.md`
- Modify: `examples/plugins/README.md`

The package is a lightweight marker/skill package named `@notara/vault`; it must not claim to provide an iframe workbench or duplicate the native panel. Its README documents the Markdown file conventions (`type`, `tags`, `source`, `learned`, `mastery`, `next_review`, `[[links]]`) and states that the Host/client native capability is the runtime owner. The skill tells an Agent to use the native vault capability when available and to keep edits bounded, reviewable Markdown changes.

- [ ] Add package metadata with the repository's existing plugin conventions and no fake workbench entry.
- [ ] Add README and skill text that describe the current first slice only.
- [ ] Run package JSON parsing and `git diff --check`.
- [ ] Commit `docs: add Notara vault plugin package`.

### Task 5: Browser verification and dev-log

**Files:**
- Create: `tests/e2e/vault-panel.spec.ts`
- Create or modify: `docs/dev-log/2026-09-20-notara-vault.md`

The E2E fixture starts an isolated DSH instance, creates `vault/资料/向量.md` and `vault/路线.md` through the test workspace setup, opens a learning workspace, opens `资产`, searches for `向量`, reads and edits the document, reloads it, verifies backlinks and confirms the conversation draft receives the asset reference. It also creates a stale save through a second read and asserts that the first draft remains visible after conflict. Capture console errors and fail on uncaught iframe/client errors.

- [ ] Write the E2E flow and run it against a fresh isolated instance.
- [ ] Run `npm run typecheck`, `npm run build`, focused unit/integration tests and the E2E test.
- [ ] Record `PASS`, `FAIL`, `BLOCKED` or `未运行` separately for contracts, typecheck, build, unit, integration and browser evidence.
- [ ] Run `git diff --check` and inspect the final diff for old RecordStore coupling.
- [ ] Commit `test: verify vault asset panel`.
