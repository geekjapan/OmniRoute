# Rust Migration TODO

This checklist follows `docs/migration/RUST_MIGRATION_ROADMAP.md`.

## Phase 0 - Inventory and Contracts

- [ ] Confirm the base branch and create an isolated feature worktree for implementation.
- [ ] Generate a route inventory covering public, client API, management, and local-only
      route classes.
- [ ] Generate a provider inventory from source and reconcile it with the generated provider
      reference before using exact provider totals.
- [ ] Generate a schema inventory for `src/shared/validation/`, `src/shared/schemas/`, and
      `open-sse/mcp-server/schemas/`.
- [ ] Generate an MCP runtime manifest covering tools, scopes, audit levels, and transports.
- [ ] Generate a DB inventory covering inline schema, migrations, indexes, and DB modules.
- [ ] Capture Chat Completions SSE fixtures.
- [ ] Capture Responses API transform fixtures.
- [ ] Capture provider request fixtures for URL, headers, body, retry, and stream behavior.
- [ ] Decide Rust workspace and crate/module boundaries.
- [ ] Record all exact counts with commands or generated inventory references.

## Phase 1 - Gateway, Authz, Safe Errors, Validation

- [ ] Implement Rust safe error envelope equivalent to `buildErrorBody`.
- [ ] Port error sanitization fixtures for stack traces, paths, tokens, and upstream details.
- [ ] Implement route classification data for public, client API, management, and local-only
      surfaces.
- [ ] Port local-only route tests for process-spawning route families.
- [ ] Port public credential helper semantics and env override precedence.
- [ ] Port upstream header denylist behavior.
- [ ] Build generated Rust and TypeScript constants for routing strategies and provider
      categories.
- [ ] Build Rust validation equivalents for high-risk Zod refinements.
- [ ] Keep TypeScript handlers behind the Rust gateway until downstream parity exists.
- [ ] Run current docs, route-validation, and error-helper gates.

## Phase 2 - Database Compatibility

- [ ] Build fixture DBs for fresh, migrated, old, encrypted, memory, skills, MCP, A2A, and
      webhook states.
- [ ] Port migration file discovery and `_omniroute_migrations` tracking.
- [ ] Preserve inline bootstrap schema compatibility.
- [ ] Preserve WAL and startup initialization behavior.
- [ ] Port AES-256-GCM field encryption.
- [ ] Add TS-to-Rust and Rust-to-TS encryption round-trip tests.
- [ ] Validate FTS5 availability and fallback behavior.
- [ ] Validate sqlite-vec packaging and dimension-reset behavior.
- [ ] Decide whether SQLCipher is optional, required, or out of scope.
- [ ] Keep TypeScript migration authority until fixture parity is proven.

## Phase 3 - Executors, Translators, Streaming

- [ ] Define Rust executor trait for URL, headers, transform, token count, request dispatch,
      retry metadata, and stream body.
- [ ] Port `BaseExecutor` retry, timeout, abort, extra-header, and logging semantics.
- [ ] Port default OpenAI-compatible executor behavior.
- [ ] Build provider family cutover order.
- [ ] Keep web/OAuth/stealth-sensitive providers behind sidecar fallback until canaries pass.
- [ ] Port request translators by format pair.
- [ ] Port response translators by format pair.
- [ ] Port Chat Completions SSE output.
- [ ] Port Responses API SSE transform.
- [ ] Add byte-level SSE tests for event order, blank lines, keepalive, final snapshots, and
      `[DONE]`.
- [ ] Add non-streaming reconstruction tests for tool calls, usage, reasoning, and metadata.
- [ ] Run shadow traffic for first provider family before live cutover.

## Phase 4 - Routing, Resilience, Compression

- [ ] Port all 15 routing strategy values.
- [ ] Add seeded ordering tests for priority, weighted, round-robin, fill-first, p2c, random,
      least-used, cost-optimized, reset-aware, reset-window, strict-random, auto, lkgp,
      context-optimized, and context-relay.
- [ ] Port target resolution and nested combo expansion.
- [ ] Port bounded event-stream peek/replay behavior.
- [ ] Port provider circuit breaker state.
- [ ] Port connection cooldown state.
- [ ] Port provider-connection-model lockout state.
- [ ] Port rate-limit queues and watchdog behavior.
- [ ] Port auto-combo scoring from a generated weight manifest.
- [ ] Port deterministic compression selection and stats.
- [ ] Port RTK and caveman fixtures before optional/ML compression engines.
- [ ] Add corpus checks preserving identifiers, code, URLs, error strings, and tool output.

## Phase 5 - Protocols and Domain Platforms

- [ ] Decide whether MCP uses an SDK or a thin custom protocol layer.
- [ ] Build MCP stdio transcript fixtures.
- [ ] Build MCP SSE and Streamable HTTP transcript fixtures.
- [ ] Implement MCP transport facade with proxy-backed handlers.
- [ ] Port scope enforcement and audit isolation.
- [ ] Reconcile MCP runtime tool registration with advertised tool count.
- [ ] Decide A2A task durability: current ephemeral runtime or durable SQLite state.
- [ ] Port A2A JSON-RPC method and error fixtures.
- [ ] Port A2A SSE heartbeat and event formatting.
- [ ] Port webhooks before memory and skills.
- [ ] Port pure domain policy modules with unit/property tests.
- [ ] Port evals only after Rust chat path exists.
- [ ] Keep memory and skills proxy-backed until DB, vector, and sandbox decisions are stable.

## Phase 6 - CLI, Packaging, Desktop

- [ ] Define Rust CLI command scope for the first release.
- [ ] Implement central process runner with array args, explicit env injection, timeout,
      stdout/stderr limits, and path validation.
- [ ] Preserve `DATA_DIR` and storage-key bootstrap behavior.
- [ ] Preserve MCP stdio stdout/stderr contract.
- [ ] Port serve command only after Rust server packaging is stable.
- [ ] Keep Electron during backend migration.
- [ ] Create Tauri parity matrix for updater, tray, window controls, login windows, IPC,
      autostart, signing, and packaged smoke.
- [ ] Prototype Tauri with retained React dashboard only after backend asset serving is stable.
- [ ] Add artifact manifest checks for npm, Docker, desktop, and VPS deployment outputs.

## Phase 7 - Quality Gates, Shadow Traffic, Cutover

- [ ] Keep JavaScript lint, typecheck, docs, coverage, Playwright, Electron, and quality
      gates for retained surfaces.
- [ ] Add Rust formatting, lint, dependency, coverage, and test gates as additive checks.
- [ ] Seed Rust coverage baseline separately from c8.
- [ ] Add Rust route/schema coverage gate.
- [ ] Add Rust safe-error serialization gate.
- [ ] Add provider shadow-traffic comparison gate.
- [ ] Add live canary gates for TLS/stealth-sensitive providers.
- [ ] Add migration-doc risk-register linter or checklist gate.
- [ ] Cut over route families behind feature flags.
- [ ] Cut over provider families behind feature flags.
- [ ] Document rollback for each cutover.

## Cross-Cutting Decisions

- [ ] Confirm "Rust-based" means backend-first, not full frontend rewrite.
- [ ] Confirm whether Tauri is required for the first Rust milestone.
- [ ] Confirm whether SQLCipher is required or optional.
- [ ] Confirm whether A2A tasks should become durable.
- [ ] Confirm whether MCP dynamic skills remain proxy-backed during early Rust phases.
- [ ] Confirm which provider families are acceptable for first live canaries.
- [ ] Confirm release target order: local gateway, CLI, npm package, Docker, desktop.

## Required Verification Before Publishing Updates

- [ ] Run `npm run check:docs-counts`.
- [ ] Run `npm run check:fabricated-docs -- --strict`.
- [ ] Run `npm run check:route-validation:t06` when route docs or route classifications change.
- [ ] Run `npm run check:error-helper` when error-handling docs or helpers change.
- [ ] Run focused unit or fixture tests for every production-code migration slice.
- [ ] Record skipped checks with the exact reason and residual risk.
