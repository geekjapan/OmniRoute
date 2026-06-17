# Rust Migration Roadmap

Status: planning deliverable. No production code migration is included in this change.

Source handoff: `D:\dev\OmniRoute\docs\handoff.md`.

Workflow results:

- `.workflow/rust-migration-roadmap/results/P1-api-streaming-routing.md`
- `.workflow/rust-migration-roadmap/results/P2-data-protocols-domain.md`
- `.workflow/rust-migration-roadmap/results/P3-ui-desktop-cli-quality.md`
- `.workflow/rust-migration-roadmap/results/P4-security-validation-shared.md`

Verified base: `e2bee77e767c3d878dc82a847c1d0fca3ce29604`.

## Executive Summary

OmniRoute can move substantial backend, routing, protocol, CLI, and desktop infrastructure
to Rust, but it should not be approached as a big-bang rewrite. The current system has too
many compatibility contracts: OpenAI-compatible streaming, Responses API transforms,
provider-specific executors, OAuth/web-session behavior, SQLite migrations, MCP transports,
A2A task semantics, dashboard i18n, Electron packaging, and security guardrails.

The recommended migration shape is a strangler-fig architecture:

1. Put a Rust gateway in front of the existing TypeScript app.
2. Port compatibility primitives first: safe errors, route classification, schema manifests,
   database/encryption fixtures, stream fixtures, and provider/header rules.
3. Move hot-path backend services by family, with shadow traffic, golden fixtures, and
   feature flags.
4. Keep the React/Next dashboard during the core migration.
5. Keep Electron until the Rust backend and asset-serving shape are stable; treat Tauri as a
   later desktop parity phase.

Blunt feasibility verdict: a Rust migration is feasible as a multi-quarter program. A
full rewrite, including the dashboard and every provider/executor in one cutover, is not a
safe plan.

## Goals

- Preserve the public OpenAI-compatible API behavior while introducing Rust backend
  components.
- Preserve SSE and Responses API byte-level compatibility.
- Preserve provider behavior, auth/header handling, retry semantics, and routing decisions.
- Preserve SQLite data compatibility, migrations, and field encryption behavior.
- Preserve MCP and A2A protocol compatibility.
- Preserve existing docs, i18n, CI, coverage, and security gates while adding Rust gates.

## Non-goals

- No immediate React dashboard rewrite.
- No immediate Electron to Tauri switch before backend packaging is stable.
- No one-shot provider catalog rewrite.
- No behavior-changing migration from ephemeral A2A task state to durable A2A task state
  without an explicit product decision.
- No removal of TypeScript gates while TypeScript surfaces remain authoritative.

## Strategy

### Strangler Boundary

The first Rust component should be a gateway that can classify routes, apply safe error
envelopes, enforce local-only constraints, and delegate to the existing TypeScript app. This
lets the team validate Rust request handling without forcing all streaming, database, and
provider behavior to move at once.

Key source anchors:

- `src/server/authz/routeGuard.ts:161` defines `isLocalOnlyPath`.
- `open-sse/utils/error.ts:47` defines `sanitizeErrorMessage`.
- `open-sse/utils/error.ts:96` defines `buildErrorBody`.
- `src/shared/constants/upstreamHeaders.ts:6` defines forbidden upstream header names.

### Compatibility First

The first Rust work should create fixtures and manifests, not feature rewrites:

- Route class manifest for public, client API, management, and local-only surfaces.
- Schema manifest for retained TypeScript clients and Rust DTOs.
- Provider manifest that can generate Rust and TypeScript constants.
- SQLite fixture DBs for migration and encryption parity.
- SSE byte fixtures for Chat Completions and Responses API.
- Provider request fixtures for URL, header, body, retry, and stream expectations.

### Sidecar Until Proven

The migration should allow Rust and TypeScript to cooperate for a long period. High-risk
areas can remain behind sidecars until parity is proved:

- TLS/JA3/JA4 stealth-sensitive providers.
- Web-cookie/browser-session providers.
- Dynamic MCP tools backed by memory, skills, Notion, Obsidian, and plugin systems.
- Custom skill execution and sandboxing.

## Frontend Decision

Keep the React/Next dashboard during the Rust migration.

The dashboard is broad, client-heavy, and i18n-heavy. The worker analysis found 42 web i18n
message files and a large dashboard route/component surface. Rewriting that to Leptos or
Dioxus would dominate the migration and delay backend parity. The migration should instead
serve or proxy the existing dashboard and expose typed Rust API contracts.

Rust/WASM UI can remain a future product decision, not a prerequisite for Rust backend
delivery.

## Target Architecture

| Layer                | Current source anchors                                                                  | Rust target                                              | Migration stance                            |
| -------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Gateway/authz        | `src/proxy.ts:5`, `src/server/authz/pipeline.ts:193`                                    | `axum` or `actix-web` with `tower` middleware            | Port early, delegate to TS handlers.        |
| Safe errors          | `open-sse/utils/error.ts:47`, `open-sse/utils/error.ts:96`                              | `thiserror`, typed safe error envelope, `tracing`        | Port before exposing Rust routes.           |
| Validation/constants | `src/shared/validation/schemas.ts:20`, `src/shared/constants/routingStrategies.ts:1`    | `serde`, `garde` or `validator`, generated manifests     | Generate Rust and TS from one source.       |
| Database             | `src/lib/db/core.ts:1182`, `src/lib/db/migrationRunner.ts:885`                          | `rusqlite` or carefully bounded `sqlx`, migration runner | Fixture parity before Rust owns writes.     |
| Encryption           | `src/lib/db/encryption.ts:30`, `src/lib/db/encryption.ts:62`                            | `aes-gcm`, compatible key derivation                     | Prove TS/Rust decrypt/encrypt both ways.    |
| Streaming            | `open-sse/handlers/chatCore.ts:1541`, `open-sse/transformer/responsesTransformer.ts:79` | `tokio`, `hyper`, `axum` SSE, stream adapters            | Byte-fixture parity before cutover.         |
| Executors            | `open-sse/executors/base.ts:349`, `open-sse/executors/index.ts:156`                     | `reqwest`, executor trait, typed registry                | Start with base/default executor.           |
| Translators          | `open-sse/translator/index.ts:120`, `open-sse/translator/formats.ts:2`                  | `serde` DTOs and snapshot fixtures                       | Port by format pair.                        |
| Routing              | `open-sse/services/combo.ts:3116`, `src/shared/constants/routingStrategies.ts:1`        | Strategy traits, seeded tests, `dashmap` state           | Port simple strategies first.               |
| Compression          | `open-sse/services/compression/types.ts:12`                                             | Native deterministic engines plus bridges                | Keep ML/stealthy parts optional.            |
| MCP                  | `open-sse/mcp-server/server.ts:110`, `open-sse/mcp-server/server.ts:1418`               | `rmcp` if mature, otherwise thin JSON-RPC layer          | Transport facade, proxy-backed tools first. |
| A2A/ACP/cloud agents | `src/app/a2a/route.ts:2`, `src/lib/a2a/taskManager.ts:18`                               | JSON-RPC/SSE service, typed task manager                 | Decide task durability before porting.      |
| CLI/services         | `bin/omniroute.mjs:35`, `src/shared/services/cliRuntime.ts:292`                         | `clap`, central process runner                           | Port process boundaries with tests.         |
| Desktop              | `electron/main.js:351`, `electron/main.js:755`                                          | Tauri later, React dashboard retained                    | Keep Electron until backend stable.         |
| Quality/CI           | `package.json:172`, `.github/workflows/ci.yml:24`                                       | Add Rust gates beside JS gates                           | Dual-stack until JS surfaces retire.        |

## Phase Plan

### Phase 0 - Inventory and Contracts

Entry criteria:

- Feature branch and isolated worktree are available.
- Existing docs gates pass or known drift is recorded.

Scope:

- Generate route, provider, schema, MCP, migration, and quality-gate inventories.
- Capture SSE and provider request fixtures.
- Decide the Rust workspace layout and crate boundaries.
- Decide dashboard scope: keep React/Next for the core migration.

Exit criteria:

- Every exact count used in migration docs comes from a command or generated inventory.
- Provider count drift is either resolved by regenerated docs or recorded as an open issue.
- Route classification and local-only route lists are explicit.

Estimated effort: 4-8 person-weeks.

### Phase 1 - Rust Gateway, Authz, Safe Errors, and Validation Spine

Scope:

- Implement Rust gateway route classification and delegation.
- Port safe error envelope and response sanitization.
- Port public credential resolution semantics and upstream header denylist.
- Create schema/constant generation for Rust and retained TypeScript clients.
- Keep all model-serving handlers in TypeScript behind the gateway.

Exit criteria:

- Local-only process-spawning routes stay inaccessible from remote clients.
- Rust safe-error fixtures match current `buildErrorBody` and sanitizer behavior.
- Route-validation and fabricated-doc gates still pass.

Estimated effort: 12-20 person-weeks.

### Phase 2 - Database Compatibility

Scope:

- Port migration runner semantics and `_omniroute_migrations` handling.
- Prove WAL, inline bootstrap schema, and migration repair behavior.
- Prove AES-256-GCM field encryption compatibility.
- Build fixture DBs for old, current, encrypted, and extension-heavy states.
- Keep TypeScript as migration authority until parity is proven.

Exit criteria:

- Rust can open and validate representative OmniRoute DBs without changing data.
- TS and Rust can decrypt/encrypt the same credential fields.
- FTS5 and sqlite-vec paths have platform packaging decisions.

Estimated effort: 14-24 person-weeks.

### Phase 3 - Executors, Translators, and Streaming Core

Scope:

- Port `BaseExecutor` semantics and the default OpenAI-compatible executor family.
- Port request/response translation by fixture-backed format pair.
- Port Chat Completions SSE and Responses API transform.
- Keep high-quirk web/OAuth/stealth executors bridged until canaries pass.

Exit criteria:

- Byte-level SSE fixtures pass for chat and Responses API.
- Provider fixture harness compares URL, headers, body, retry, and stream behavior.
- No live provider family is cut over without shadow comparison.

Estimated effort: 35-55 person-weeks.

### Phase 4 - Routing, Resilience, and Compression

Scope:

- Port all 15 routing strategies from `ROUTING_STRATEGY_VALUES`.
- Port target resolution, nested combos, bounded stream peeking, and context relay.
- Port provider breaker, connection cooldown, model lockout, and rate-limit queues as
  separate state machines.
- Port deterministic compression selection and engines first; bridge optional/ML engines.

Exit criteria:

- Strategy tests with seeded candidate pools match current ordering and fallback behavior.
- Resilience state machines do not collapse provider, connection, and model scopes.
- Compression corpus checks preserve identifiers, code, error strings, URLs, and tool data.

Estimated effort: 24-40 person-weeks.

### Phase 5 - Protocols and Domain Platforms

Scope:

- MCP transport facade with proxy-backed handlers, then native pure tools.
- A2A JSON-RPC/SSE service after deciding ephemeral versus durable task state.
- Webhooks and pure domain policies.
- Evals after the Rust chat path exists.
- Memory and skills later unless MCP forces earlier proxy integration.

Exit criteria:

- MCP stdio, SSE, and Streamable HTTP transcript fixtures pass.
- A2A method and task-state fixtures preserve source spelling and semantics.
- Webhook signatures, retry/backoff, and URL guards match current behavior.

Estimated effort: 35-60 person-weeks.

### Phase 6 - CLI, Packaging, and Desktop Parity

Scope:

- Rust CLI entrypoint for serve, MCP stdio, config/env bootstrap, and process runner.
- Preserve `DATA_DIR`, `.env`, storage-key bootstrap, and platform PATH behavior.
- Keep Electron while backend packaging stabilizes.
- Prototype Tauri only after Rust local server and dashboard asset strategy are stable.

Exit criteria:

- Process spawning uses array args, explicit env injection, timeouts, and path validation.
- Packaged app smoke tests pass with the retained dashboard.
- Tauri parity matrix is complete before any shell cutover.

Estimated effort: 25-45 person-weeks.

### Phase 7 - Dual-Stack Quality Gates, Shadow Traffic, and Cutover

Scope:

- Add Rust formatting, lint, dependency, coverage, and test gates beside current JS gates.
- Keep Playwright and i18n gates while React remains.
- Run shadow traffic and live canaries for provider families.
- Cut over provider families and route families by flag, with rollback.

Exit criteria:

- Current coverage floor remains protected for retained TypeScript.
- Rust coverage has its own baseline and ratchet.
- Release artifacts have manifest checks for npm, Docker, desktop, and VPS deploys.

Estimated effort: 25-45 person-weeks.

### Effort Summary

Core strangler migration estimate: 174-297 person-weeks.

This assumes a small experienced team, fixture-driven parity, retained React/Next dashboard,
and delayed Tauri/full UI rewrite. A full dashboard rewrite would add roughly 70-120
person-weeks before product redesign or retranslation work.

## Subsystem Deep Dive

| Subsystem                | Complexity             | Recommended migration shape                                                     | Main risks                                                                        |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `http-api-authz`         | High                   | Rust gateway and authz middleware first, delegating handlers to TS.             | Fail-open route classification, local-only bypass, consumed request bodies.       |
| `streaming-core`         | Very high              | Fixture-backed Rust stream primitives, then chat and Responses API.             | SSE byte drift, final snapshots, client disconnects, buffering.                   |
| `executors-translators`  | Very high              | Base/default executor first, high-quirk providers bridged.                      | Provider quirks, retry/backoff, headers, tool calls, reasoning, images.           |
| `routing-resilience`     | Very high              | Strategy contracts and separate state machines, then auto/compression.          | Strategy drift, flattened breaker/cooldown/lockout semantics, queue leaks.        |
| `database`               | Very high              | Compatibility harness before Rust owns writes.                                  | Migration drift, encryption compatibility, FTS5/sqlite-vec packaging.             |
| `mcp-server`             | Very high              | Rust transport facade with proxy-backed tools first.                            | SDK maturity, dynamic tools, scopes, audit isolation, transport semantics.        |
| `agent-protocols`        | High                   | A2A sidecar/gateway after task durability decision.                             | In-memory vs durable tasks, JSON-RPC errors, process/external provider contracts. |
| `frontend-dashboard`     | Very high if rewritten | Keep React/Next; generate typed contracts to Rust APIs.                         | API drift and i18n regression across 42 locales.                                  |
| `electron-desktop`       | High                   | Keep Electron; Tauri after local Rust server is stable.                         | Updater, tray, login windows, IPC, autostart, signing.                            |
| `cli-bootstrap-services` | High                   | Rust CLI and central process runner in phases.                                  | Shell/path/env safety, MCP stdout contract, config writes.                        |
| `domain-extras`          | Very high              | Policy/webhooks first, evals after chat, memory/skills later.                   | Vector/search parity, sandboxing, cache invalidation, webhook drift.              |
| `security-stealth`       | Very high              | Native safe-error/security primitives; sidecar for stealth until canaries pass. | TLS/JA3/JA4 parity, proxy fail-open, raw error exposure.                          |
| `validation-shared`      | High                   | Generated manifests and Rust validators with Zod parity fixtures.               | Lost refinements, TS/Rust constant drift, provider count drift.                   |
| `testing-quality-cicd`   | Very high              | Add Rust gates beside JS gates; retire gates only with explicit replacements.   | Mixed coverage denominators, CI time, artifact layout regressions.                |

## Risk Register

| ID  | Area                         | Severity | Mitigation                                                          | Cutover gate                                                                                     |
| --- | ---------------------------- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| R1  | Big-bang rewrite             | Critical | Use gateway/sidecar strangler plan.                                 | No subsystem cutover without fixtures and rollback.                                              |
| R2  | SSE/Responses compatibility  | Critical | Raw-byte fixtures and replay harness.                               | Chat and Responses fixtures pass against TS and Rust.                                            |
| R3  | Provider executor quirks     | Critical | Port by provider family with golden URL/header/body/retry fixtures. | Shadow traffic agrees before live cutover.                                                       |
| R4  | TLS/JA3/JA4 stealth          | Critical | Keep sidecar/fallback and run live canaries.                        | Provider-specific canary passes.                                                                 |
| R5  | Authz/local-only routes      | Critical | Data-driven route manifest and local-only tests.                    | All process-spawning routes classified local-only.                                               |
| R6  | SQLite/encryption parity     | Critical | Fixture DBs and TS/Rust encryption round trips.                     | Rust validates old/current/encrypted DB fixtures.                                                |
| R7  | MCP surface drift            | High     | Runtime manifest and transcript tests.                              | Stdio, SSE, and Streamable HTTP fixtures pass.                                                   |
| R8  | A2A task semantics           | High     | Decide ephemeral vs durable state before implementation.            | Task lifecycle fixtures match intended behavior.                                                 |
| R9  | Dashboard rewrite scope      | High     | Keep React/Next during core migration.                              | Rust API contracts cover retained dashboard calls.                                               |
| R10 | Quality gate regression      | High     | Dual-stack CI and independent Rust baselines.                       | JS gates remain for retained JS; Rust gates are additive.                                        |
| R11 | Schema/constants drift       | High     | Generate Rust and TS artifacts from one manifest.                   | Manifest diff gate passes.                                                                       |
| R12 | Process spawning security    | High     | Central process runner with array args and typed env injection.     | Runner tests pass on Windows, macOS, and Linux.                                                  |
| R13 | Memory/skills platform scope | High     | Proxy first, native later after DB and sandbox review.              | MCP tool fixtures pass with proxy/native mix.                                                    |
| R14 | Docs fabrication             | Medium   | Run docs count/fabricated-doc gates after synthesis.                | `npm run check:docs-counts` and `npm run check:fabricated-docs` pass or failures are documented. |

## Quality-Gate Parity Map

| Current gate                         | Rust migration treatment                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| `npm run check:docs-counts`          | Keep. Use generated inventories before exact counts enter docs.     |
| `npm run check:fabricated-docs`      | Keep. Add migration-doc risk-register checks later.                 |
| `npm run check:route-validation:t06` | Keep for TS. Add Rust route/schema coverage gate.                   |
| `npm run check:error-helper`         | Keep for TS. Add Rust safe-error serialization gate.                |
| `npm run typecheck:core`             | Keep while TS remains. Add Rust type/build gate.                    |
| `npm run test:vitest`                | Keep for MCP/TS surfaces until replaced by transcript parity tests. |
| `npm run test:e2e`                   | Keep Playwright while React dashboard remains.                      |
| `npm run test:coverage`              | Keep c8 baseline for TS. Add separate Rust coverage baseline.       |
| `npm run quality:gate`               | Extend rather than replace; do not mix coverage denominators.       |
| Electron packaged smoke              | Keep until Tauri parity is proven with equivalent packaged smoke.   |

## Decision Log

- Decision: Use strangler-fig migration, not big-bang rewrite.
- Decision: Keep React/Next dashboard during core migration.
- Decision: Keep Electron until Rust backend packaging is stable.
- Decision: Treat TLS/stealth providers as sidecar/fallback candidates until canaries pass.
- Decision: Treat database compatibility as a prerequisite to Rust-owned writes.
- Decision: Keep JS gates for retained JS surfaces and add Rust gates beside them.

## Open Questions

- Should A2A task state remain ephemeral, matching current runtime behavior, or become durable
  because migrations already define task tables?
- Which Rust MCP SDK path is mature enough for the current 87-tool, 30-scope, three-transport
  surface?
- Should app-level AES-256-GCM remain the only credential-at-rest protection, or should a
  SQLCipher layer be added as an optional storage layer?
- Which provider count is canonical after provider-reference regeneration? Intermediate
  source parsing found drift, so exact provider totals should not be restated until the
  generator and docs agree.
- Which compression engines become native Rust, which remain TypeScript sidecars, and which
  become optional features?

## At-A-Glance Timeline

| Quarter | Focus                                                  | Exit signal                                                  |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Q1      | Inventories, gateway, authz, safe errors, schemas      | Rust gateway delegates safely to TS.                         |
| Q2      | DB compatibility, base executor, streaming fixtures    | Rust can validate DBs and replay chat streams.               |
| Q3      | Provider families, routing/resilience, MCP/A2A facades | Selected route/provider families shadow successfully.        |
| Q4      | CLI packaging, domain tools, quality gates, canaries   | Feature-flag cutovers and rollback paths are operational.    |
| Q5+     | Tauri/full UI/native memory-skills as needed           | Product-driven parity projects, not core migration blockers. |

## Verification Notes

The workflow ran four isolated worker packets on feature branches and copied their results
into `.workflow/rust-migration-roadmap/results/`. Key live checks included:

- DB module and migration counts from filesystem.
- Routing strategy count from `src/shared/constants/routingStrategies.ts`.
- MCP tool and scope inventory from source.
- Docs count and fabricated-doc gates in the security/validation packet.
- Targeted `rg` inspection of route guards, error helpers, public credentials, providers,
  streaming handlers, executors, translators, database, MCP, A2A, Electron, CLI, and CI files.

Run the roadmap checklist in `docs/migration/RUST_MIGRATION_TODO.md` before implementation.
