# Packet P4 - Security, Validation, Shared Constants

Worktree: `C:\Users\geekjapan\.codex\worktrees\8f13\OmniRoute-rust-roadmap-p4`

Branch: `feature/rust-roadmap-security-validation`

Base checked: `e2bee77e767c3d878dc82a847c1d0fca3ce29604`

Scope: planning-only assessment for `security-stealth`, `validation-shared`, and
docs accuracy/risk-register checks for the Rust migration roadmap. No production-code
changes were made.

## Executive Summary

Security and validation are not a thin translation layer. The TypeScript codebase has
source-enforced conventions around sanitized client errors, embedded public OAuth defaults,
upstream header denylisting, route-locality gates for process-spawning routes, and Zod
schemas that are reused across API, provider, MCP, and dashboard surfaces.

The highest-risk Rust migration item is TLS/stealth parity. Basic HTTP dispatch can move to
Rust, but JA3/JA4 and exact CLI fingerprint behavior currently depend on JS/native packages
and captured provider quirks. A Rust rewrite should plan a sidecar/compatibility bridge until
live canaries prove parity.

Docs accuracy is also a migration risk. The canonical docs gates passed for fabricated claims
and strict counts, but `npm run check:docs-counts` reported two soft executor-count drifts.
Future migration docs must not freeze counts or route/function names without running the doc
gates and source greps.

## Subsystem: security-stealth

### current_stack

- Error sanitization is centralized in `open-sse/utils/error.ts`: `sanitizeErrorMessage`
  strips stack traces and paths at `open-sse/utils/error.ts:47`, key filtering blocks stack,
  trace, path, password, secret, token, and key fields at `open-sse/utils/error.ts:60`, and
  `buildErrorBody` is the network envelope helper at `open-sse/utils/error.ts:96`.
- HTTP/SSE helper wrappers route through `buildErrorBody` in `open-sse/utils/error.ts:129`,
  `open-sse/utils/error.ts:148`, and `open-sse/utils/error.ts:313`.
- The error policy is documented as the source of truth in
  `docs/security/ERROR_SANITIZATION.md:9`; the doc explicitly warns against returning
  `err.stack` or `err.message` in responses at `docs/security/ERROR_SANITIZATION.md:153`.
- Public upstream OAuth/Firebase defaults are resolved through `resolvePublicCred` and
  `resolvePublicCredMulti` in `open-sse/utils/publicCreds.ts:191` and
  `open-sse/utils/publicCreds.ts:203`. Runtime env overrides are decoded at
  `open-sse/utils/publicCreds.ts:194` and `open-sse/utils/publicCreds.ts:209`.
- Public credential helper tests cover Gemini, Antigravity, Windsurf Firebase, env override,
  multi-env precedence, and decode behavior in `tests/unit/publicCreds.test.ts:27`,
  `tests/unit/publicCreds.test.ts:39`, `tests/unit/publicCreds.test.ts:49`,
  `tests/unit/publicCreds.test.ts:78`, and `tests/unit/publicCreds.test.ts:93`.
- Upstream header denylisting has a shared constant source in
  `src/shared/constants/upstreamHeaders.ts:6`, with auth headers separately owned by the
  credential layer in `src/shared/constants/upstreamHeaders.ts:30`.
- Custom upstream header schemas reuse the canonical record schema and reject forbidden
  header names in `src/shared/validation/schemas.ts:758` through
  `src/shared/validation/schemas.ts:772`, then add auth-header rejection in
  `src/shared/validation/schemas.ts:1725`.
- Generic TLS impersonation uses `wreq-js` as a Chrome 124/macOS session in
  `open-sse/utils/tlsClient.ts:66`, `open-sse/utils/tlsClient.ts:152`, and
  `open-sse/utils/tlsClient.ts:154`. The circuit opens after repeated failures at
  `open-sse/utils/tlsClient.ts:98`.
- TLS proxy resolution for impersonation clients is fail-closed in
  `open-sse/services/tlsClientProxy.ts:6` and throws rather than silently bypassing a failed
  configured proxy at `open-sse/services/tlsClientProxy.ts:24`.
- Stealth docs identify JA3/JA4, header ordering, JSON body ordering, and integrity-token
  surfaces in `docs/security/STEALTH_GUIDE.md:13`, with the generic wreq-js profile at
  `docs/security/STEALTH_GUIDE.md:23` and per-provider header/body ordering at
  `docs/security/STEALTH_GUIDE.md:149`.
- Route locality gates classify process-spawning route families as local-only:
  `/api/mcp/`, `/api/cli-tools/runtime/`, `/api/services/`, and dashboard service embeds in
  `src/server/authz/routeGuard.ts:28` through `src/server/authz/routeGuard.ts:32`.
- `isLocalOnlyPath` enforces prefix/pattern checks at `src/server/authz/routeGuard.ts:161`.
  Tests assert local-only behavior and non-bypassability for spawn-capable services in
  `tests/unit/authz/routeGuard.test.ts:15`, `tests/unit/authz/routeGuard.test.ts:45`,
  `tests/unit/authz/routeGuard.test.ts:180`, and `tests/unit/authz/routeGuard.test.ts:187`.
- Child-process safety is mixed by surface but has explicit safe wrappers. Embedded npm
  installers use `execFile` arrays in `src/lib/services/installers/utils.ts:5` and
  `src/lib/services/installers/utils.ts:86`. MITM NSS updates use `exec` with runtime values
  passed through `env` at `src/mitm/cert/install.ts:89` and `src/mitm/cert/install.ts:93`.

### rust_targets

- `thiserror` plus a dedicated `ErrorEnvelope` module for client-safe error bodies, with
  tests proving stack/path/token redaction.
- `tracing` and `tracing-error` for internal diagnostics, explicitly separated from
  network-facing error serialization.
- `serde_json` redaction visitor for upstream details, matching the current key blocklist.
- `secrecy`, `zeroize`, and a small public-credential defaults module for embedded public
  OAuth/Firebase values and env override precedence.
- `http::HeaderName` plus a static forbidden-header set, preferably generated from one
  canonical source used by both Rust and retained TypeScript UI code.
- `axum`/`tower` middleware for route classification and loopback enforcement.
- `tokio::process::Command` wrappers that require array args and typed env injection for
  every runtime value.
- TLS choices: `reqwest`/`hyper` with `rustls` for normal providers; a guarded
  `boring`/BoringSSL or sidecar-based impersonation path for JA3/JA4 parity; `rcgen` and
  `rustls-pemfile` for MITM/certificate tooling.

### complexity

very_high

The sanitization, public credential, header, and route-guard logic is tractable. TLS/JA3/JA4
and exact provider stealth behavior is the hard part because Rust HTTP clients do not provide
a drop-in equivalent for the current Chrome 124, Firefox-style, and CLI-captured fingerprints.

### key_tasks

- Port `sanitizeErrorMessage`, `sanitizeUpstreamDetails`, and `buildErrorBody` first, then
  require every Rust route/stream/tool error to use the safe envelope.
- Create redaction golden tests from current JS behavior, including stack frames, Windows
  absolute paths, POSIX paths, nested upstream details, and blocked secret-ish keys.
- Port public credential resolution semantics exactly: embedded defaults, env override,
  multi-env precedence, raw Google-style passthrough, and strict base64 acceptance.
- Generate or share the upstream-header denylist so Rust request builders, Rust validation,
  and any retained TS dashboard cannot drift.
- Implement route classification as data, not ad hoc middleware, with explicit local-only
  route families and tests for remote host, spoofed loopback headers, and manage-scope carveout.
- Replace shell-script interpolation with typed command wrappers and env injection; preserve
  current platform-specific MITM/cert command behavior only behind explicit tests.
- Build a stealth parity harness before porting stealth traffic: capture official CLI traffic,
  record JA3/JA4/header/body order, then compare Rust/sidecar requests against those captures.
- Keep the current Node/native stealth clients as a compatibility sidecar until live canaries
  prove Rust parity for Cloudflare-protected providers.

### risks

- `risk`: TLS/JA3/JA4 parity falls short, causing providers to challenge or ban otherwise
  valid sessions.
  `severity`: critical.
  `mitigation`: use a strangler approach with sidecar fallback, packet capture baselines, and
  provider-specific canary tests before any cutover.
- `risk`: Rust error `Display`/`Debug` accidentally exposes stack-like source paths or
  upstream raw messages.
  `severity`: high.
  `mitigation`: central safe error envelope, lints/tests banning raw error serialization at
  network boundaries, and fixture parity with `open-sse/utils/error.ts`.
- `risk`: Public OAuth identifiers are mistaken for secrets or embedded as scanner-triggering
  literals.
  `severity`: high.
  `mitigation`: keep helper semantics, document public-vs-secret status, and add scanner tests
  for new providers.
- `risk`: Header denylist diverges between Rust gateway and TS dashboard/provider settings.
  `severity`: high.
  `mitigation`: generate both language bindings from one manifest and require tests for
  sanitize plus schema behavior.
- `risk`: A process-spawning route misses local-only classification during route migration.
  `severity`: critical.
  `mitigation`: route manifest gate requiring explicit class for every route that invokes
  `tokio::process` or service supervisors.
- `risk`: Proxy resolution fails open in Rust stealth code.
  `severity`: high.
  `mitigation`: preserve fail-closed proxy resolution and test configured-but-unusable proxy
  cases.

### blockers

- No confirmed Rust-native crate was found in this inspection that can be treated as a
  drop-in replacement for current JA3/JA4 stealth behavior.
- The Rust target architecture must decide whether stealth providers remain in a Node sidecar,
  use a BoringSSL/curl-impersonate bridge, or accept a feature gap.
- Production stealth parity cannot be validated from static tests alone; it needs live
  provider canaries and captured official-client baselines.

### depends_on

- `executors-translators` for upstream request construction.
- `http-api-authz` for route classification and authz middleware.
- `cli-bootstrap-services` for child-process and embedded-service lifecycle wrappers.
- `testing-quality-cicd` for security gates, live canaries, and static scan parity.
- `database` for encrypted credential storage and audit records.

### effort_person_weeks

18-30 person-weeks.

Assumes a strangler migration with sidecar fallback. A full Rust-native stealth rewrite with
validated JA3/JA4 parity could exceed this range.

### notes

- Treat stealth parity as a release gate, not a refactor detail.
- The current `npm run check:error-helper` pass scanned 610 files and kept 7 known-missing
  frozen entries, so Rust should include an equivalent "no new raw client error" gate.
- The current route validation gate scanned 505 route files and passed, giving a useful
  baseline for a Rust route manifest gate.

## Subsystem: validation-shared

### current_stack

- Zod v4 is the central validation layer. Shared schemas are exported from
  `src/shared/validation/schemas.ts`, including `validateBody` at
  `src/shared/validation/schemas.ts:20`.
- Route validation is enforced by `scripts/check/check-route-validation.mjs`: it accepts
  `validateBody(...)` or `.safeParse(...)` for `request.json()` callsites at
  `scripts/check/check-route-validation.mjs:10` and `scripts/check/check-route-validation.mjs:11`.
- Provider constant validation is explicit: `ProviderSchema` is defined at
  `src/shared/validation/providerSchema.ts:26`, `ProvidersMapSchema` at
  `src/shared/validation/providerSchema.ts:49`, and `validateProviders` uses `safeParse` at
  `src/shared/validation/providerSchema.ts:56`.
- Provider maps are validated at module load in `src/shared/constants/providers.ts:3138`
  through `src/shared/constants/providers.ts:3146`.
- Current provider map sections in `src/shared/constants/providers.ts` include
  `NOAUTH_PROVIDERS`, `OAUTH_PROVIDERS`, `WEB_COOKIE_PROVIDERS`, `APIKEY_PROVIDERS`,
  `LOCAL_PROVIDERS`, `SEARCH_PROVIDERS`, `AUDIO_ONLY_PROVIDERS`,
  `UPSTREAM_PROXY_PROVIDERS`, `CLOUD_AGENT_PROVIDERS`, and `SYSTEM_PROVIDERS`
  (`src/shared/constants/providers.ts:2929` through `src/shared/constants/providers.ts:2938`).
- The generated provider reference remains the canonical docs count source and currently says
  `Total providers: **226**` at `docs/reference/PROVIDER_REFERENCE.md:13`.
- A direct read-only parse of `src/shared/constants/providers.ts` found 232 unique provider
  map keys across the current provider sections, with duplicate keys `phind` and
  `huggingchat`. This is not a replacement for the generator; it is evidence that provider
  counts are drift-prone and must be regenerated/checked before roadmap publication.
- Routing strategies are centralized in `src/shared/constants/routingStrategies.ts:1`; a
  source parse found 15 `ROUTING_STRATEGY_VALUES` and 8 `AUTO_ROUTING_STRATEGY_VALUES`.
- MCP tool inputs/outputs are Zod schemas in `open-sse/mcp-server/schemas/tools.ts:44`
  onward; routing strategy tool schemas reuse shared constants at
  `open-sse/mcp-server/schemas/tools.ts:540`.
- MCP scope enforcement centralizes caller scopes and required scopes in
  `open-sse/mcp-server/scopeEnforcement.ts:111` and computes missing scopes at
  `open-sse/mcp-server/scopeEnforcement.ts:125`.
- Current MCP tool inventory is 87 total by source parse: 33 base registry entries plus
  memory 3, skill 4, agent-skill 3, gamification 8, plugin 8, notion 6, and obsidian 22.
  Unique MCP scopes parsed from tool definitions: 30.

### rust_targets

- `serde` and `serde_json` for request/response structs.
- `validator` or `garde` for field-level checks; use custom validators where Zod refinements
  currently encode security rules.
- `schemars` or `utoipa` for JSON Schema/OpenAPI generation, with generated TS types if the
  React/Next dashboard remains.
- `strum` or generated enums for routing strategies, provider categories, MCP scopes, route
  classes, and service kinds.
- A build-time provider manifest validator, preferably using TOML/JSON/RON data plus Rust
  typed validation rather than hand-edited duplicated constants.
- `phf` or generated static maps for provider aliases and header denylist lookups.
- `rmcp` or MCP SDK integration only after verifying schema and scope enforcement parity;
  otherwise keep the current MCP server behind the strangler boundary.

### complexity

high

The Rust type system helps once schemas are ported, but the migration must preserve Zod
refinements, partial-record behavior, custom header security rules, provider-specific
validation branches, and schema reuse between API routes, MCP tools, provider settings, and
dashboard forms.

### key_tasks

- Inventory every exported Zod schema in `src/shared/validation/`, `src/shared/schemas/`,
  `open-sse/mcp-server/schemas/`, and domain-specific schema files before designing Rust
  equivalents.
- Classify each schema as request body, response body, config, DB-adjacent validation,
  provider constant validation, or MCP tool contract.
- Preserve exact rejection behavior for upstream headers: control characters, whitespace,
  colon, max count, max value length, hop-by-hop/framing denylist, and auth-header rejection.
- Convert routing strategies and auto-routing strategies to Rust enums generated from one
  source of truth, with normalization fallback matching
  `src/shared/constants/routingStrategies.ts:48`.
- Create a provider manifest build step that validates every provider entry, aliases, service
  kinds, risk notice variants, and category membership.
- Generate JSON Schema for retained TypeScript surfaces; avoid maintaining separate Rust and
  TS schemas manually.
- Port MCP tool schemas and scope metadata together so each Rust tool registration has its
  input schema, output schema, scopes, audit level, and tests in one definition.
- Add property/golden tests comparing selected Zod validation failures to Rust validation
  failures before moving routes.

### risks

- `risk`: Zod refinements are simplified into Rust structs and security validation is lost.
  `severity`: high.
  `mitigation`: port refinements as named validators with fixture parity tests.
- `risk`: Provider constants split across Rust and TS, causing dashboard and gateway drift.
  `severity`: high.
  `mitigation`: generate both Rust and TS artifacts from a provider manifest.
- `risk`: Generated provider count and constants-map count diverge without detection.
  `severity`: medium.
  `mitigation`: make provider-reference generation part of the roadmap doc gate and avoid
  hand-authored counts except in evidence sections.
- `risk`: MCP scope metadata moves separately from tool schemas.
  `severity`: high.
  `mitigation`: define a single Rust `ToolDefinition` struct carrying schemas, scopes, audit,
  and handler.
- `risk`: `z.record(z.enum(...))`/partial-record semantics change during porting.
  `severity`: medium.
  `mitigation`: add explicit sparse-map fixtures for each schema using the current Zod 4 notes
  in `src/shared/validation/schemas.ts:822`.

### blockers

- A frontend strategy decision is needed. If the React dashboard remains, Rust schemas must
  generate TS/JSON Schema artifacts for client reuse.
- Provider count/source-of-truth must be clarified by the generator before final roadmap docs
  claim a new exact count.
- MCP Rust SDK maturity must be assessed against the current 87-tool, 30-scope contract.

### depends_on

- `frontend-dashboard` for TS schema generation requirements.
- `mcp-server` for tool registration and scope semantics.
- `executors-translators` for provider request/response contracts.
- `routing-resilience` for strategy enum and auto-routing config parity.
- `testing-quality-cicd` for schema parity and route-validation gates.

### effort_person_weeks

12-20 person-weeks.

Assumes provider constants move to a generated manifest and the dashboard remains TypeScript.
Manual dual-maintenance of Rust and TS schema/constants would raise the estimate.

### notes

- The canonical docs count gate currently treats `docs/reference/PROVIDER_REFERENCE.md` as the
  provider count source. If the source constants have moved beyond that generated file, the
  roadmap synthesis should flag regeneration rather than inventing a count.
- `npm run check:route-validation:t06` passed with 505 route files scanned, making it a useful
  baseline for a Rust route manifest or OpenAPI/schema coverage gate.

## Subsystem: docs-accuracy-risk-register

### current_stack

- AGENTS.md requires grepping before documenting API names, endpoints, paths, CLI commands,
  env vars, counts, or strategy names (`AGENTS.md:20` through `AGENTS.md:38`).
- `check:fabricated-docs` scans `docs`, `AGENTS.md`, `open-sse/AGENTS.md`, and
  `src/lib/db/AGENTS.md` per `scripts/check/check-fabricated-docs.mjs:45`.
- Fabricated-doc checks cover API paths, env vars, CLI commands, hook names, and file refs at
  `scripts/check/check-fabricated-docs.mjs:9` through `scripts/check/check-fabricated-docs.mjs:15`.
- The same script indexes route files under `src/app/api` at
  `scripts/check/check-fabricated-docs.mjs:356` and env reads at
  `scripts/check/check-fabricated-docs.mjs:400`.
- `check:docs-counts` reads the provider total from generated provider reference text in
  `scripts/check/check-docs-counts-sync.mjs:72`, counts routing strategies from
  `src/shared/constants/routingStrategies.ts` at `scripts/check/check-docs-counts-sync.mjs:55`,
  and builds strict/soft checks at `scripts/check/check-docs-counts-sync.mjs:120`.
- `package.json` wires `check:docs-counts`, `check:fabricated-docs`, and `check:docs-all` at
  `package.json:104`, `package.json:107`, and `package.json:108`.
- `docs/architecture/QUALITY_GATES.md:78` through `docs/architecture/QUALITY_GATES.md:84`
  documents `check:docs-all`, `check:docs-counts`, and `check:fabricated-docs` as
  CI-relevant docs gates.
- There is currently no `docs/migration` directory in this worktree. The requested result
  file is under `.workflow/`, so the existing docs gates do not scan it unless future workflow
  tooling explicitly includes `.workflow`.
- No dedicated migration risk-register linter was found. The handoff requires risk-register
  content in final migration docs, but enforcement is currently procedural rather than scripted.

### rust_targets

- Keep the existing Node docs gates during the migration, or port them later into a Rust
  `xtask docs-check` after behavior is frozen.
- A Rust route/schema manifest can make fabricated endpoint and schema-reference checks more
  reliable than regex-only scans.
- Add a migration-doc linter that checks `docs/migration/*.md` for required sections:
  subsystem fields, source citations, risk register severity/mitigation, quality-gate parity,
  and verification evidence.
- Use a generated inventory file for provider counts, routing strategies, MCP tools/scopes,
  DB migrations, route classes, and quality gates; consume that inventory from roadmap docs.

### complexity

medium

The current gates already cover the most dangerous fabricated claims. The missing piece is a
migration-specific linter that verifies roadmap structure and risk-register completeness,
especially for cross-cutting risks that do not map to one source symbol.

### key_tasks

- Add `docs/migration/` to the roadmap publication workflow and confirm it is included by
  existing `docs` scans.
- Require every exact count in migration docs to cite a command or generated inventory file.
- Add a risk-register schema for roadmap docs: `id`, `area`, `severity`, `likelihood`,
  `impact`, `mitigation`, `owner/subsystem`, `validation_gate`, and `cutover_blocking`.
- Add a checklist gate that ensures the high-risk topics from this packet are present:
  error sanitization, public credentials, upstream headers, child-process safety, route guard
  local-only tiers, TLS/JA3 stealth, Zod/schema parity, provider constants, routing constants,
  and docs guardrails.
- Extend fabricated-doc checks or add a companion rule for Rust crate/tool names if the final
  roadmap recommends specific Rust dependencies.
- Run `npm run check:docs-all` or at least `npm run check:docs-counts` plus
  `npm run check:fabricated-docs -- --strict` before publishing migration docs.
- Treat soft count drift as a risk-register entry when the roadmap relies on that count.

### risks

- `risk`: Migration docs cite plausible but unverified Rust crates, source paths, route names,
  provider counts, or tool counts.
  `severity`: high.
  `mitigation`: enforce grep/count evidence and use generated inventories.
- `risk`: Cross-cutting security risks are scattered across subsystem notes and omitted from
  the final risk register.
  `severity`: high.
  `mitigation`: require a migration-doc risk-register checklist and synthesis review.
- `risk`: `.workflow` intermediate results are treated as authoritative docs even though docs
  gates scan `docs`, not `.workflow`.
  `severity`: medium.
  `mitigation`: final roadmap must rerun gates after copying/synthesizing into `docs/migration`.
- `risk`: Soft docs-count drift is ignored because strict gates pass.
  `severity`: medium.
  `mitigation`: include soft drift in roadmap open questions or regenerate affected docs.

### blockers

- No migration docs exist yet in this worktree, so this packet can only define required checks
  for future `docs/migration/*` outputs.
- No scripted risk-register linter exists yet; it must be added or tracked as a roadmap task.

### depends_on

- All analysis packets for complete risk inventory.
- `testing-quality-cicd` for final gate mapping.
- Synthesis/critique phase to merge subsystem risks into one canonical register.

### effort_person_weeks

2-4 person-weeks.

Includes migration-doc linting, generated inventory plumbing, and CI wiring. Excludes fixing
unrelated doc drift discovered by those gates.

### notes

- `npm run check:docs-counts` passed strict counts but reported soft executor-count drift:
  real executor count 61 was not mentioned in two architecture docs.
- `npm run check:fabricated-docs -- --strict` exited 0.
- The roadmap should state when a count is "canonical generated docs count" versus "direct
  source-map parse" if both are used during analysis.

## Combined Cross-Cutting Risk Checklist

- [ ] Every network-facing Rust error path uses a safe envelope equivalent to
      `buildErrorBody`, with no raw `err.stack`, source paths, tokens, or upstream raw exception
      strings.
- [ ] Internal logging preserves useful diagnostics through `tracing`, but network responses
      serialize only sanitized messages and sanitized upstream details.
- [ ] Public upstream OAuth/Firebase identifiers use helper-based embedded defaults and env
      overrides; new public defaults include tests and scanner rationale.
- [ ] Header denylist is generated from one canonical source and shared by Rust gateway,
      validation schemas, and retained TS dashboard code.
- [ ] Operator-supplied custom headers cannot override credential-owned auth headers.
- [ ] Route classes are explicit and test-covered; process-spawning route families remain
      local-only unless a deliberate, reviewed carveout exists.
- [ ] Child-process wrappers require array args and typed env injection; no runtime value is
      interpolated into shell scripts.
- [ ] TLS/JA3/JA4 stealth parity has captured official-client baselines, automated comparison,
      and live canary gates before provider cutover.
- [ ] Proxy resolution for stealth clients fails closed when configured proxy resolution errors.
- [ ] Zod refinements are mapped to named Rust validators with golden failure fixtures.
- [ ] Provider constants, aliases, service kinds, risk notices, and category memberships are
      generated or validated from one manifest.
- [ ] Routing strategy and auto-routing strategy enums are generated from one canonical source.
- [ ] MCP tools carry input schema, output schema, scopes, audit level, and handler together;
      scope denials remain audited.
- [ ] Final migration docs include a risk register with severity, mitigation, validation gate,
      and cutover-blocking status for each high-risk item.
- [ ] Final migration docs run fabricated-claim and count gates after synthesis, not only on
      intermediate `.workflow` packet files.

## Verification Evidence

Commands run from `C:\Users\geekjapan\.codex\worktrees\8f13\OmniRoute-rust-roadmap-p4`:

- `Get-Content -Raw -LiteralPath AGENTS.md`
- `Get-Content -Raw -LiteralPath CLAUDE.md`
- `Get-Content -Raw -LiteralPath D:\dev\OmniRoute\docs\handoff.md`
- `git status --short --branch`
- `git rev-parse HEAD`
- `git branch --show-current`
- `rg --files src open-sse docs scripts tests .workflow | rg "(error|publicCreds|upstreamHeaders|tlsClient|routeGuard|providerSchema|providers|routingStrategies|mcp-server|migration|quality|fabricated|risk|stealth|PUBLIC_CREDS|ERROR_SANITIZATION|ROUTE_GUARD|STEALTH|validation|zod|schemas)"`
- `rg -n "export function sanitizeErrorMessage|export function buildErrorBody|export function sanitizeErrorValue|stack|SECRET|TOKEN|DATABASE|API_KEY|JWT|OMNIROUTE|ErrorBody" open-sse\utils\error.ts src\lib\api\errorResponse.ts docs\security\ERROR_SANITIZATION.md tests\unit\error-message-sanitization.test.ts tests\unit\check-error-helper.test.ts`
- `rg -n "PUBLIC_CRED|resolvePublicCred|definePublicCred|decodePublicCred|client_id|clientSecret|firebase|base64|metadata" open-sse\utils\publicCreds.ts docs\security\PUBLIC_CREDS.md tests\unit\publicCreds.test.ts src\lib\oauth\providers\gemini.ts src\lib\oauth\providers\antigravity.ts src\lib\oauth\providers\windsurf.ts`
- `rg -n "FORBIDDEN|forbidden|header|customHeadersSchema|z\.record|validateProviders|ProviderSchema|safeParse" src\shared\constants\upstreamHeaders.ts src\shared\validation\schemas.ts src\shared\validation\providerSchema.ts`
- `rg -n "TlsClient|tls|JA3|fingerprint|proxy|circuit|fetchWith|DEFAULT|chrome|undici|agent" open-sse\utils\tlsClient.ts open-sse\services\tlsClientProxy.ts docs\security\STEALTH_GUIDE.md tests\unit\tlsClient-circuit-breaker.test.ts`
- `rg -n "LOCAL_ONLY|isLocalOnlyPath|classifyRoute|RouteClass|PUBLIC|CLIENT_API|MANAGEMENT|/api/mcp|/api/cli-tools/runtime|/api/services|/dashboard/providers/services" src\server\authz\routeGuard.ts docs\security\ROUTE_GUARD_TIERS.md tests\unit\authz\routeGuard.test.ts`
- `rg -n "z\.object|z\.enum|ProviderSchema|providerSchema|PROVIDER_CONFIG_SCHEMA|safeParse|parse\(|superRefine|register|provider" src\shared\validation\providerSchema.ts src\shared\constants\providers.ts tests\unit\provider-validation-hardening.test.ts tests\unit\provider-validation-specialty.test.ts tests\unit\new-content-providers.test.ts`
- `rg -n "ROUTING_STRATEGY_VALUES|RoutingStrategy|z\.enum|priority|weighted|context-relay|lkgp|reset-aware|set_routing_strategy|routingStrategy" src\shared\constants\routingStrategies.ts open-sse\mcp-server\schemas\tools.ts open-sse\mcp-server\__tests__\routingStrategyTool.test.ts tests\unit\combo-quality-validator-reasoning.test.ts`
- `rg -n "MCP_TOOLS|inputSchema|z\.object|TOTAL_MCP_TOOL_COUNT|OMNIROUTE_MCP_SCOPES|scope|scopes|createMcpServer|tools" open-sse\mcp-server\schemas\tools.ts open-sse\mcp-server\server.ts open-sse\mcp-server\scopeEnforcement.ts open-sse\mcp-server\toolCardinality.ts docs\frameworks\MCP-SERVER.md`
- `rg -n "exec\(|spawn\(|spawnSync|execFile|child_process|env:\s*\{|updateNssDatabases|runNpm|buildSpawnArgsFactory|SERVICES\[|isLocalOnlyPath" src\mitm src\lib\services src\app\api\services src\app\api\cli-tools bin open-sse\mcp-server`
- `rg -n "validateBody|safeParse|request\.json\(|z\.object|createProviderSchema|customHeadersSchema|upstreamHeadersRecordSchema" src\app\api\providers src\app\api\v1 src\shared\validation\schemas.ts scripts\check\check-route-validation.mjs`
- Read-only Node stdin parser for provider map counts in `src/shared/constants/providers.ts`
  - Result: sum 234 entries across provider sections, 232 unique keys, duplicate keys
    `phind` and `huggingchat`.
- Read-only Node stdin parser for routing strategies in
  `src/shared/constants/routingStrategies.ts`
  - Result: 15 routing strategies, 8 auto-routing strategies.
- Read-only Node stdin parser for MCP tools/scopes
  - Result: 87 tools total; 30 unique scopes.
- `npm run check:docs-counts`
  - Result: exit 0. Strict counts passed; two soft executor-count drifts reported.
- `npm run check:error-helper`
  - Result: exit 0. Scanned 610 files; 7 known-missing frozen.
- `npm run check:route-validation:t06`
  - Result: exit 0. Scanned 505 route files; all `request.json()` usages validated.
- `npm run check:fabricated-docs -- --strict`
  - Result: exit 0.

Notes:

- Import-based count probes using `node --import tsx/esm` failed because `tsx` was not
  installed in this worktree. They were replaced with read-only source parsers.
- `Test-Path docs\migration` returned `False`; no existing migration docs were inspected in
  this worktree.
