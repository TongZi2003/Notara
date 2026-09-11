# Native capability wiring (P1.5)

Scope: which DeepSeek Harness seams StudyForge consumes instead of rebuilding, and
what the native seam still does not give the product. Version lock stays
`0.1.5-rc.2` (tag commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`); the file is
evidence from the exact installed packages in this checkout, not a plan.

Evidence lanes:

- integration (deterministic): `npm run test:integration -- tests/integration/native-capability-wiring.test.ts`
- live (external credential): `npm run test:live -- tests/live/native-capabilities.test.ts`

The integration lane mounts the real services and substitutes only the model
wire through the public `LlmAdapter` / `ctx.llm.registerAdapter` seam
(`tests/fixtures/native-agent.ts`). Every other service under test — session,
projection, system prompt, tools, agent loop, subagents, skills — is the
published DSH implementation.

## Web (`ctx.web`)

Installed packages: `dsh-web` (service), `dsh-web-search-deepseek` (search
provider `deepseek-official`), `dsh-web-fetch-http` (fetch provider, anonymous
public HTTP(S)), `dsh-tool-web` (the `web_search` / `web_fetch` tool row).

- Provider selection is config, not a hidden priority chain: the seam pins
  `searchProvider` / `fetchProvider`; a configured id that is not registered
  raises `WEB_PROVIDER_CONFIGURED_MISSING`, and a single registered usable
  provider auto-selects. Confirmed by reading `dsh-web` types and by the live
  assembly test.
- The live lane verifies the product row is `searchProvider: deepseek-official`
  + `fetchProvider: http` and that `ctx.tools` exposes both tools after the real
  rows activate. `apply(ctx, config)` on these plugins does **not** materialize
  schema defaults, so a test mounting by direct `apply` must pass every limit
  (`maxResponseBytes`, `maxBodyChars`, `timeoutMs`, `maxRedirects` for fetch);
  the product composition mounts the plugin objects instead.
- Anonymous `ctx.web.fetch('https://example.com/')` has returned HTTP 200,
  original content and the provider's real `truncated` flag in the live lane.
- **BLOCKED (external):** one real `web_search` → `web_fetch` with its real URL
  and truncation was **not** run. No `DEEPSEEK_API_KEY`-class credential is
  present in this environment; the runner reports `DEEPSEEK_API_KEY: MISSING
  (BLOCKED)` and the live test is skipped with that reason. Package presence is
  **not** a functional pass. Until a credentialed run happens, P4/P9 must not
  report search as verified. A runnable real-model prompt-update + child test
  is also present and explicitly blocked by the same missing credential.

## Subagents (`ctx.subagents`)

Installed packages: `dsh-subagent` (service + continuation manager),
`dsh-subagent-spawn-in-process` (provider `spawn`), `dsh-subagent-fork-in-process`
(provider `fork`). The official tool row is
`dsh-tool-subagent` with `provider: spawn, toolName: subagent,
backgroundMode: continuable` (owned by the Host wiring, not this doc).

Verified in the integration lane:

- One-shot `start('spawn', …)`: the returned run id equals the published child
  session id, `run.localAgent.session.header.parentSession` is the delegating
  parent, and a text result arrives with `stopReason: 'completed'`.
- Route inheritance: the child request carries the parent provider/model unless
  `agentOptions` overrides them; an override reaches only the child request.
- Registration scope: the in-process child gets a **fresh flat registration
  scope**, joined to the parent's standing preset when a preset is mounted.
  `access-binding.test.ts` mounts the actual product learning preset through
  native Loader/AgentPresets, spawns a child, checks its header and prepared
  tool catalog, then reads its own cross-subject file and denies another root.
  A tool registered on the shared context is part of the child's
  environment (confirmed visible in the child request), while an
  agent-scoped prompt section or tool restriction on the parent does **not**
  leak into the child. Teaching rules intended for a delegated child therefore
  belong in the child's own `persona`/creation options, not in a parent-scoped
  section the child will not see.
- `persona` is registered as a scoped shadowing section on the child — it is
  present in the child's assembled system prompt and absent from the parent's.
- `outputSchema`: the child uses the native `structured_output` tool and
  `result.structured` returns the schema-validated value.
- Continuable: `startContinuable` requires a session-persistence backend
  (`dsh-session-persistence-jsonl`); with it mounted the manager allocates the
  child id, accepts an initial prompt id, accepts a later `sendMessage`, and
  `interrupt` aborts an actually in-flight second request and
  `drainContinuableChildren` releases the child. A cold child additionally
  requires the native session-query provider; the fixture mounts its exact-read
  backend with an isolated JSONL store. The child's own
  requests are observable per session. The id is manager-allocated, so callers
  must not assume a caller-derived name.
- `fork` inherits the parent's completed-turn prefix; the child request text
  contains the parent turn, while `spawn` starts empty.

Role rules (search/命题/制作) are configuration differences only and must not
own a second lifecycle.

## Dynamic system prompt and skills

- `ctx.systemPrompt.section({ text: (ctx) => … })` is re-evaluated on each
  assembly: a section whose captured value changes produces the new text in the
  next prepared request and drops the old text. This is the seam for a teaching
  choice or temporary requirement changed inside one live session — confirmed by
  the integration test, not only by reading the type.
- `ctx.skills` merges provider catalogs; `dsh-skill-filesystem` with
  `includeDefaultRoots: false` + `customSkillDirs` lists and loads a real
  on-disk skill without reading the operator's home. The provider scans project
  roots and directories directly, and loads bodies through `ctx.fs` when one is
  mounted.
- `dsh-agent-presets` is **not** a teaching-selection mechanism: it only
  switches composition for an empty session. In-class changes use the teaching
  configuration plus the dynamic prompt section.

## Native fs observation and the code-runtime gap

`dsh-fs-observation-policy` records reads and supplies write/edit intents;
`dsh-fs-local` performs the atomic stale/version check. The real tool + both
plugins + authorized creation backend pass no-read denial, external edit
conflict, reread and successful save tests. The
student scope adds grants around it (`packages/host/src/access/context.ts`,
`installToolAccess`). The gap that must stay documented, not silently enabled:

- `dsh-code-runtime-worker-thread` declares model code as **bash-equivalent
  trust** despite an empty environment and heap cap. A PTC
  (`tools` `mode: ptc`) presentation would let the model reach every visible
  tool through `run_code`.
- Product policy rejects that: `installToolAccess` denies `run_code`, `bash`,
  `pwsh`, `shell`, and `terminal` in the native `ctx.tools.guard`, so the guard
  covers both a model-direct call and PTC nested dispatch (the guard runs on the
  registry execution, not on the model-facing name alone).
- The product therefore does **not** enable PTC; `dsh-code-runtime-worker-thread`
  is not mounted for the student scope. Any future PTC adoption is a deliberate
  trust-boundary change, not a wiring tweak.

## SDK declaration packaging fix (rc.2, retained)

`@deepseek-ai/dsh-subagent@0.1.5-rc.2` publishes `lib/types/index.d.ts` with
`import` of the projection *value* types but without the corresponding
`declare module '@deepseek-ai/dsh-session-projection'` augmentation imports
from its own `projection.d.ts` / `catalog.d.ts`. Those two files widen
`SessionProjectionMap` and `SessionProjectionStateMap`. Under TS 6 strict mode
the missing graph makes `SessionProjectionRegistry.register` reject the
subagent's own projection keys (`"subagent"` is absent from
`SessionProjectionStateMap`), failing `tsc` in the *consumer*, not in the
package.

Resolution is the smallest declaration-only fix, held as a digest-locked
patch in `scripts/patch-sdk.ts` (applied by `postinstall`, alongside the P0
generator-declaration fix):

- Prepend `import type {} from "./projection.ts";` and
  `import type {} from "./catalog.ts";` to the published
  `dsh-subagent/lib/types/index.d.ts`, so the augmentations join the graph.
- The patch asserts the original and patched SHA-256 values and refuses an
  unknown revision, so a DSH bump fails loud instead of silently keeping a
  stale patch. `rc.2` keeps the same disposition as the P0 generator fix: the
  version/build patch stays with `package-lock.json` until an upstream release
  ships the imports itself.
- It changes only `d.ts` imports — no runtime code, no public API, no
  handwritten replacement of the SDK's own types. `skipLibCheck` is not used
  to mask it; the strict `tsconfig.tests.json` run stays authoritative.

## What the product still owns

Native seams cover identity/session, storage, model routing, web, subagents,
prompt assembly, and skills. StudyForge adds only the learning objects and the
actual grants: execution binding, student file scope, and the lesson/asset
semantics. No second subagent manager, search service, prompt infrastructure, or
file-tool set is created.

## Reproduce

```sh
# deterministic wiring (real services, scripted model wire)
npm run test:integration -- tests/integration/native-capability-wiring.test.ts

# live lane: provider assembly always; real search BLOCKED without DEEPSEEK_API_KEY
npm run test:live -- tests/live/native-capabilities.test.ts
```

`npm run test:live` and `scripts/test-live.ts` are the installed live entry point.
`npm run typecheck:tests` validates test calls against the real SDK under the
same strict rules as production, with no `skipLibCheck`.
