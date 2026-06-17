# P2 Data, Protocols, Domain Extras

Worker packet for the Rust migration roadmap. Scope is read-only assessment of the
`database`, `mcp-server`, `agent-protocols`, and `domain-extras` subsystems.

Source handoff read: `docs/handoff.md`. Worktree instructions read from
`AGENTS.md` and `CLAUDE.md` in this worktree before analysis.

## Evidence Baseline

- Database inventory: 83 TypeScript files under `src/lib/db` and 97 SQL migrations under
  `src/lib/db/migrations`, verified by PowerShell counts. Migration filenames currently run
  from `001_initial_schema.sql` through `099_proxy_family.sql`.
- DB core: `DATA_DIR` and `SQLITE_FILE` are resolved in `src/lib/db/core.ts:65` and
  `src/lib/db/core.ts:67`; `getDbInstance()` starts at `src/lib/db/core.ts:1182`, enables
  WAL at `src/lib/db/core.ts:1335`, executes inline `SCHEMA_SQL` at
  `src/lib/db/core.ts:1339`, and creates `_omniroute_migrations` at
  `src/lib/db/core.ts:1348`.
- Migration runner: the file states migrations are all-or-nothing per file at
  `src/lib/db/migrationRunner.ts:9`; `runMigrations()` starts at
  `src/lib/db/migrationRunner.ts:885`; per-file application uses `db.transaction()` at
  `src/lib/db/migrationRunner.ts:1019` and records applied versions at
  `src/lib/db/migrationRunner.ts:1034`.
- Field encryption: `src/lib/db/encryption.ts:30` sets `aes-256-gcm`; the env key is
  `STORAGE_ENCRYPTION_KEY` at `src/lib/db/encryption.ts:62`; ciphertext format is documented
  at `src/lib/db/encryption.ts:5`; connection credential fields are encrypted at
  `src/lib/db/encryption.ts:214`.
- MCP inventory: fixed advertised count is 87 tools by source arithmetic in
  `open-sse/mcp-server/server.ts:110`; the base `MCP_TOOLS` registry contains 33 entries at
  `open-sse/mcp-server/schemas/tools.ts:1390`. Static counts from tool modules are memory 3,
  skills 4, agent-skill 3, gamification 8, plugin 8, Notion 6, Obsidian 22.
- MCP scopes: 30 unique non-Node scopes were found across `open-sse/mcp-server/**/*.ts`.
  Scope enforcement reads `OMNIROUTE_MCP_ENFORCE_SCOPES` and `OMNIROUTE_MCP_SCOPES` at
  `open-sse/mcp-server/server.ts:103`, evaluates scope matches at
  `open-sse/mcp-server/scopeEnforcement.ts:99`, and supports `*` / prefix wildcard matching at
  `open-sse/mcp-server/scopeEnforcement.ts:61`.
- MCP transports: stdio starts in `open-sse/mcp-server/server.ts:1418`; HTTP transport modes are
  documented in `open-sse/mcp-server/httpTransport.ts:8`; Streamable HTTP sessions are tracked
  in `_streamableSessions` at `open-sse/mcp-server/httpTransport.ts:29`; route guards for SSE
  and streamable HTTP are in `src/app/api/mcp/sse/route.ts:17` and
  `src/app/api/mcp/stream/route.ts:17`.
- A2A lifecycle: task state is `submitted | working | completed | failed | cancelled` in
  `src/lib/a2a/taskManager.ts:18`; valid transitions are in
  `src/lib/a2a/taskManager.ts:66`; default TTL is 5 minutes at
  `src/lib/a2a/taskManager.ts:82`; cleanup runs at `src/lib/a2a/taskManager.ts:204`.
- A2A API: `/a2a` supports `message/send`, `message/stream`, `tasks/get`, and `tasks/cancel`
  per `src/app/a2a/route.ts:2`; the six skill handlers are wired at
  `src/lib/a2a/taskExecution.ts:19`; the Agent Card says A2A v0.3 at
  `src/app/.well-known/agent.json/route.ts:5`.
- Agent side protocols: ACP declares 14 built-in CLI agent definitions in
  `src/lib/acp/registry.ts:10`, but `AcpManager.spawn()` allows only four agent ids at
  `src/lib/acp/manager.ts:42`. Cloud agents register `jules`, `devin`, and `codex-cloud` at
  `src/lib/cloudAgent/registry.ts:6`, with the abstract provider boundary in
  `src/lib/cloudAgent/baseAgent.ts:33`.
- Domain extras: `src/domain` has 17 TypeScript modules. Memory has 13 top-level modules under
  `src/lib/memory`, skills has 13 under `src/lib/skills`, guardrails has 8 under
  `src/lib/guardrails`, evals has 2 under `src/lib/evals`.
- Memory schema: `memories` is created in `src/lib/db/migrations/015_create_memories.sql:5`,
  FTS5 in `src/lib/db/migrations/022_add_memory_fts5.sql:29`, and vector metadata in
  `src/lib/db/migrations/083_memory_vec.sql:7`; runtime sqlite-vec table creation depends on
  active embedding dimensions in `src/lib/memory/vectorStore.ts:108`.
- Skills schema: `skills` and `skill_executions` are created in
  `src/lib/db/migrations/016_create_skills.sql:5`; skill mode/source metadata is added in
  `src/lib/db/migrations/027_skill_mode_and_metadata.sql:4`; Docker sandbox spawning is in
  `src/lib/skills/sandbox.ts:95`.
- Evals schema/runtime: `eval_runs` is created at
  `src/lib/db/migrations/030_create_eval_runs.sql:1`, `eval_suites` and `eval_cases` at
  `src/lib/db/migrations/031_create_eval_suites.sql:1`; built-in suite registration is listed at
  `src/lib/evals/evalRunner.ts:946`; runtime forces non-streaming chat calls at
  `src/lib/evals/runtime.ts:209` and loops cases sequentially at `src/lib/evals/runtime.ts:282`.
- Webhooks: 7 event variants are declared in `src/lib/webhooks/eventDescriptions.ts:1`;
  HMAC signing is in `src/lib/webhookDispatcher.ts:21`; retries/backoff are in
  `src/lib/webhookDispatcher.ts:107`; delivery fan-out uses `Promise.allSettled` at
  `src/lib/webhookDispatcher.ts:208`; auto-disable threshold is called at
  `src/lib/webhookDispatcher.ts:209`.

## Subsystem: database

- current_stack:
  - TypeScript persistence layer around SQLite/better-sqlite3 with singleton connection,
    inline bootstrap schema, WAL journaling, versioned SQL migrations, and app-level
    AES-256-GCM field encryption.
  - 83 domain DB modules own table groups; route/handler code should go through these modules
    rather than raw SQL. Migrations cover protocol tables (`002_mcp_a2a_tables.sql`), memory,
    skills, evals, webhooks, cloud-agent credentials, quotas, plugins, proxies, and model
    intelligence.
  - Encryption is optional passthrough when `STORAGE_ENCRYPTION_KEY` is absent, but encrypted
    values use `enc:v1:<iv_hex>:<ciphertext_hex>:<authTag_hex>` and static-salt key derivation.
- rust_targets:
  - `rusqlite` plus `r2d2` or a small async boundary for synchronous SQLite operations, or
    `sqlx` only if the migration accepts a bigger async rewrite and runtime SQL verification.
  - Migration runner crate/internal module that preserves existing `_omniroute_migrations`
    semantics and the current duplicate-version/name repair behavior.
  - `aes-gcm` plus `scrypt`/`ring`/`argon2` equivalent for app-level field encryption; evaluate
    SQLCipher only as an optional storage-encryption layer, not as a drop-in replacement for
    field encryption.
  - Typed repository modules per table family, generated or hand-written from existing TS
    domain modules.
- complexity: very_high
- key_tasks:
  - Freeze schema inventory: map all 97 migrations, the inline `SCHEMA_SQL`, and DB modules to a
    Rust repository/module map.
  - Build compatibility tests that initialize a copy of an existing SQLite DB, run Rust
    migrations, and compare `_omniroute_migrations`, schema, indexes, and representative rows.
  - Port encryption helpers first and prove TS<->Rust decrypt/encrypt interoperability,
    including legacy dynamic-salt migration paths.
  - Preserve WAL, backup, startup repair, and migration marker behavior before moving any
    handlers onto Rust DB access.
  - Create a migration policy for ad hoc runtime DDL such as `cloud_agent_tasks` in
    `src/lib/cloudAgent/db.ts:19`.
- risks:
  - Schema drift between inline bootstrap schema and migration files can create split-brain
    installs if Rust initializes differently from TS.
  - Optional encryption passthrough is operationally convenient but dangerous to reinterpret;
    Rust must preserve exact behavior while surfacing secure configuration warnings.
  - better-sqlite3 is synchronous; naive async Rust wrappers can either block Tokio worker
    threads or introduce transaction ordering changes.
  - SQLite extension parity for FTS5 and sqlite-vec is platform-sensitive.
- blockers:
  - Decide whether Rust owns DB initialization immediately, or first reads/writes through an
    interop API while TS remains migration authority.
  - Decide whether to preserve app-level field encryption exactly, add SQLCipher, or support
    both in layered form.
  - Need fixture DBs representing old and current migration states before any cutover.
- depends_on:
  - validation-shared for request/body schemas that feed DB writes.
  - security-stealth for encryption and secret-handling rules.
  - routing-resilience, mcp-server, agent-protocols, and domain-extras because they all persist
    state through these modules.
- effort_person_weeks: 14-22
  - Assumes one senior Rust engineer and one TS/domain reviewer, with compatibility fixtures and
    migration tests included. Add 4-6 weeks if SQLCipher is required as a hard launch feature.
- notes:
  - Treat database as a compatibility substrate, not a clean rewrite. The safest migration shape
    is to port encryption and migration verification first, then move low-write repositories,
    then hot-path repositories.

## Subsystem: mcp-server

- current_stack:
  - TypeScript MCP server built on `@modelcontextprotocol/sdk`, with stdio, SSE-style HTTP, and
    Streamable HTTP transports.
  - Fixed advertised tool count is 87 from `TOTAL_MCP_TOOL_COUNT`, but `createMcpServer()` also
    iterates `compressionTools` separately at `open-sse/mcp-server/server.ts:1256`. This should be
    audited because static counting and runtime registration may not describe the same surface.
  - 30 MCP scopes, environment fallback scopes, optional enforcement, wildcard scope matching,
    SQLite audit logging to `mcp_tool_audit`, runtime heartbeat, description compression, and
    accessibility filtering.
  - Tool families span routing, cache, compression/CCR, 1proxy, memory, skills, agent skills,
    plugins, gamification, Notion, and Obsidian.
- rust_targets:
  - Evaluate `rmcp` for protocol scaffolding, but plan for a custom thin MCP JSON-RPC layer over
    `tokio`, `axum`, and `tower` if SDK maturity blocks parity.
  - `tokio::process` or stdio transport module for CLI mode; `axum` routes for streamable HTTP
    and SSE-compatible behavior.
  - Tool registry as typed Rust trait objects with serde schemas generated from a shared schema
    source or a Rust-first schema model exported back to TS.
  - Scope/audit middleware that wraps every tool call uniformly.
- complexity: very_high
- key_tasks:
  - Produce a canonical tool manifest from runtime registration, not from docs, and reconcile the
    87-count vs compressionTools registration discrepancy.
  - Port scope matching, caller context extraction, audit hashing/summarization, and heartbeat
    status before tool handlers.
  - Split tools into pure/local DB tools, HTTP proxying tools, and integration tools so they can
    move in waves.
  - Preserve dynamic skill-to-MCP tool registration from the skills table
    (`open-sse/mcp-server/server.ts:1371`) or intentionally replace it with an explicit registry.
  - Rebuild protocol E2E tests for stdio, SSE, and Streamable HTTP before switching clients.
- risks:
  - Rust MCP SDK maturity and client compatibility may be the largest unknown; tool metadata,
    streaming semantics, and session headers must match current clients exactly.
  - Dynamic tool registration from DB-backed skills makes the runtime tool set non-static.
  - Audit logging intentionally never breaks execution; Rust must preserve that failure isolation.
  - Scope enforcement defaults off unless `OMNIROUTE_MCP_ENFORCE_SCOPES=true`; changing the
    default would be a breaking security/ops change.
- blockers:
  - Need a golden MCP manifest and transcript fixtures from current stdio/HTTP clients.
  - Need decision on whether Rust hosts all tools or proxies some tool families back to TS during
    strangler phases.
  - Need to verify duplicate/extra compression tool registration before estimating final surface.
- depends_on:
  - database for audit, settings, memory, skills, plugins, Notion/Obsidian metadata.
  - domain-extras for memory/skills tools.
  - http-api-authz/security for local-only route classification and management auth.
- effort_person_weeks: 12-20
  - Assumes protocol scaffolding, fixed tool registry, scopes, audit, and a first wave of pure
    tools. Full Notion/Obsidian/plugin parity may push beyond this range.
- notes:
  - The recommended strangler move is Rust transport plus proxy-backed handlers first, then
    migrate tool families behind the same protocol facade.

## Subsystem: agent-protocols

- current_stack:
  - A2A JSON-RPC 2.0 endpoint at `/a2a`, six skill handlers, Agent Card at
    `/.well-known/agent.json`, SSE streaming wrapper with 15-second heartbeat, and in-memory task
    manager with TTL cleanup.
  - A2A code spells the terminal cancel state as `cancelled`, not `canceled`; roadmap docs and
    Rust types should follow source.
  - A2A migration `002_mcp_a2a_tables.sql` creates `a2a_tasks` and `a2a_task_events`, but the
    current runtime manager stores tasks in memory. This is a semantic mismatch to resolve.
  - ACP discovers 14 CLI agents, but process spawning is allowlisted to four ids in
    `AcpManager.spawn()`. It uses `spawn(..., shell: false)` and child stdin/stdout buffers.
  - Cloud agents expose provider abstractions for `jules`, `devin`, and `codex-cloud`, with
    encrypted credentials in `cloud_agent_credentials`, task APIs under `/api/v1/agents/*`, and
    provider-specific REST clients.
- rust_targets:
  - `axum` JSON-RPC endpoint plus strongly typed A2A method enum, `tokio_stream` SSE wrapper,
    and task manager backed by either `DashMap`/`RwLock` for current semantics or SQLite if the
    product chooses durable protocol tasks.
  - ACP process manager with `tokio::process::Command`, explicit binary allowlists, timeout/idle
    response collection, and structured stdout/stderr events.
  - Cloud-agent provider trait with `reqwest`, typed status mapping, encrypted credential access,
    and background polling hooks.
- complexity: high
- key_tasks:
  - Decide whether A2A tasks remain process-memory state or become durable SQLite rows; update
    Agent Card/task APIs accordingly.
  - Port JSON-RPC error/status behavior and SSE event formatting before porting individual skills.
  - Reconcile ACP registry vs spawn allowlist and document intentional support levels.
  - Port cloud-agent credentials and status transitions only after DB encryption parity is proven.
  - Build protocol transcript tests for `message/send`, `message/stream`, `tasks/get`,
    `tasks/cancel`, ACP spawn/kill, and cloud-agent task CRUD.
- risks:
  - A2A settings gate, auth behavior, and JSON-RPC error codes are easy to change accidentally.
  - In-memory A2A tasks are fast but non-durable; switching to SQLite would alter visible behavior
    such as cleanup and post-restart task availability.
  - ACP child-process behavior is OS-sensitive, especially Windows path lookup and signal/kill
    semantics.
  - Cloud-agent APIs depend on external provider contracts and credentials, so live parity tests
    may be required for confidence.
- blockers:
  - Product decision: ephemeral vs durable A2A task state.
  - Security decision: whether `/a2a` continues to use `OMNIROUTE_API_KEY` fallback auth or moves
    to the shared management/API-key policy stack.
  - Need live or mocked cloud-agent provider contract fixtures for Jules, Devin, and Codex Cloud.
- depends_on:
  - database for credentials, task persistence if chosen, and routing/audit tables.
  - mcp-server for agent-skill bridges and shared protocol schemas.
  - http-api-authz and security route-guard decisions.
- effort_person_weeks: 8-14
  - Assumes A2A and ACP are ported with mock provider tests; add 3-5 weeks for cloud-agent live
    provider certification and durable A2A migration.
- notes:
  - This subsystem is a good candidate for a Rust sidecar/gateway phase because it has clear
    HTTP/SSE boundaries and fewer direct frontend dependencies than the dashboard.

## Subsystem: domain-extras

- current_stack:
  - `src/domain` contains 17 modules for policy evaluation, fallback, budget/cost rules,
    lockout, quota cache, provider expiration, model availability, degradation, config audit,
    responses, prompts, routing tags, and pipeline glue.
  - Memory combines SQLite `memories`, FTS5, runtime sqlite-vec, optional Qdrant, embedding source
    resolution, extraction, retrieval, injection, reindexing, summarization, and best-effort
    background vector writes.
  - Skills combine DB registry/executions, built-ins, injection, interception, marketplace
    providers, custom skills, hybrid modes, and a Docker-backed sandbox runner.
  - Guardrails are a fail-open hook registry with defaults for vision-bridge, PII masking, and
    prompt injection at `src/lib/guardrails/registry.ts:264`.
  - Evals include seven built-in suites, custom persisted suites, historical runs, target types
    `suite-default | model | combo`, non-streaming chat execution, and sequential case execution.
  - Webhooks include 7 event types, HMAC-signed custom deliveries, Slack/Discord/Telegram payload
    transforms, URL validation, retries, delivery history, and auto-disable after 10 failures.
- rust_targets:
  - Domain policy crate/module with pure functions first, then DB-backed repositories and caches.
  - Memory crate using `rusqlite` FTS5, sqlite-vec or Qdrant client, async embedding providers,
    and a queue for reindex/vector side effects.
  - Skills crate with registry/executor abstractions; keep Docker sandbox or replace with a
    stricter container/isolation boundary via `tokio::process`.
  - Guardrail trait pipeline with fail-open behavior and per-request disable headers.
  - Evals runner crate reusing the Rust chat gateway internally.
  - Webhook dispatcher using `reqwest`, `hmac`/`sha2`, outbound URL guard parity, and a bounded
    retry/background delivery worker.
- complexity: very_high
- key_tasks:
  - Split pure domain modules from stateful DB/cache modules and port pure policy functions first.
  - Preserve budget window math, lockout cache semantics, quota refresh intervals, and fallback
    ordering with focused unit/property tests.
  - For memory, prove FTS5 search parity, sqlite-vec dimension reset behavior, Qdrant config
    normalization, and injection placement across providers.
  - For skills, port registry/execution DB shapes and decide whether custom skill execution stays
    in TS during early Rust phases.
  - For guardrails, preserve fail-open logging and per-request opt-out headers; do not turn
    guardrail failures into request failures.
  - For evals, keep scoring strategies exact/contains/regex/custom and maintain run history
    schemas before adding concurrency.
  - For webhooks, port signature headers, retry policy, URL guard, delivery retention, and
    integration-specific payload transforms.
- risks:
  - Memory is the highest-risk domain extra because it spans DB schema, vector extensions,
    embeddings, Qdrant, async background work, and request mutation.
  - Skills sandboxing is security-sensitive and currently Docker/process dependent.
  - Domain modules mix in-memory caches and DB state; Rust ports must avoid silently changing cache
    invalidation and refresh timing.
  - Webhook docs are partly stale: docs claim no separate delivery table, but migration
    `069_webhook_deliveries.sql` and `src/lib/db/webhookDeliveries.ts` exist.
  - Evals currently force `stream: false`; adding streaming parity during migration would expand
    scope.
- blockers:
  - Need decide whether memory/skills move with MCP first or remain TS-backed behind MCP proxy
    handlers.
  - Need platform plan for sqlite-vec distribution and fallback behavior.
  - Need sandbox security model review before reimplementing skill execution.
  - Need a webhook outbound URL guard parity test corpus.
- depends_on:
  - database for memory, skills, evals, webhooks, budgets, quotas, and settings.
  - streaming-core/executors for eval execution and memory/guardrail request mutation.
  - mcp-server because memory and skills expose MCP tools.
  - validation-shared for Zod-to-Rust schema parity.
- effort_person_weeks: 18-30
  - Assumes memory and skills are included. If the first Rust phase only ports policy/evals/webhooks
    and proxies memory/skills to TS, estimate drops to 8-14 weeks.
- notes:
  - Recommended sequencing: policy and webhooks first, evals after chat gateway exists, memory and
    skills last unless MCP requires them earlier.

## Combined Risk Summary

1. SQLite compatibility is the foundation risk. WAL, migration repair, inline bootstrap schema,
   field encryption, FTS5, sqlite-vec, and Qdrant metadata all need fixture-driven parity before
   Rust can own writes.
2. MCP is protocol-high-risk because the visible surface is large, partially dynamic, and uses
   three transports. The runtime registration/count discrepancy around compression tools should
   be resolved before synthesis.
3. A2A has an explicit semantic decision: source code currently uses in-memory task state even
   though migrations define A2A task tables. Rust should not accidentally change task durability.
4. ACP/cloud-agent boundaries are security-sensitive because they spawn processes or call
   external task providers. Keep them behind management auth and explicit allowlists.
5. Domain extras are deceptively large. Memory and skills are closer to mini-platforms than helper
   modules; they should not be bundled into an early "easy domain logic" phase.
6. Documentation drift exists in several places (DB subdirectory AGENTS counts, A2A provider
   wording, webhook delivery-table docs). The roadmap should rely on source and commands, not
   static docs.

## Suggested Sequencing For This Packet

1. Database compatibility harness: migrations, encryption, fixture DBs.
2. Webhooks and pure domain policy functions: high value, manageable HTTP/DB boundaries.
3. A2A Rust sidecar/gateway: clear JSON-RPC/SSE interface, decide task durability up front.
4. MCP transport facade with proxy-backed tools: preserve clients while tool families migrate.
5. Evals runner on top of Rust chat path.
6. Memory and skills: late phase unless MCP dynamic tools require earlier proxy integration.
7. ACP/cloud agents: after security and process/external-provider fixtures are ready.

## Verification Evidence

Commands run from `<packet-worktree-P2>`
unless noted otherwise:

- `Get-Content -Raw AGENTS.md`
- `Get-Content -Raw CLAUDE.md`
- `Get-Content -Raw docs/handoff.md`
- `(Get-ChildItem src\lib\db -Filter *.ts).Count`
- `(Get-ChildItem src\lib\db\migrations -Filter *.sql).Count`
- `rg -n "better-sqlite3|journal_mode|SCHEMA_SQL|getDbInstance|DATA_DIR|CREATE TABLE|_omniroute_migrations" src\lib\db\core.ts src\lib\db\migrationRunner.ts`
- `rg -n "aes-256-gcm|createCipheriv|createDecipheriv|ENCRYPTION_KEY|randomBytes|authTag|encrypt|decrypt" src\lib\db\encryption.ts src\lib\db\core.ts`
- `rg -n "db\.transaction|BEGIN|COMMIT|ROLLBACK|INSERT INTO _omniroute_migrations|readMigrationFiles|runMigrations|apply|transaction" src\lib\db\migrationRunner.ts`
- `rg -n "TOTAL_MCP_TOOL_COUNT|MCP_TOOLS|memoryTools|skillTools|agentSkillTools|gamificationTools|pluginTools|notionTools|obsidianTools|createMcpServer|registerTool" open-sse\mcp-server\server.ts open-sse\mcp-server\schemas\tools.ts`
- PowerShell regex count for base `MCP_TOOLS` entries in `open-sse\mcp-server\schemas\tools.ts`
- PowerShell regex count for MCP tool-family `name:` entries in `open-sse\mcp-server\tools\*.ts`
- PowerShell regex count/list of unique MCP scopes under `open-sse\mcp-server\**\*.ts`
- `rg -n "SSE|Streamable|/api/mcp/sse|/api/mcp/stream|McpServer|StdioServerTransport|startMcpStdio" open-sse\mcp-server src\app\api\mcp bin`
- `rg --files src\lib\a2a src\lib\acp src\lib\cloudAgent src\app | rg "(a2a|agent\.json|cloudAgent|acp)"`
- `(Get-ChildItem src\lib\a2a\skills -Filter *.ts).Count`
- `rg -n "message/send|message/stream|tasks/get|tasks/cancel|jsonrpc|SSE|Agent Card|agent.json|A2A" src\app src\lib\a2a`
- `rg -n "requireCloudAgentManagementAuth|CloudAgent|cloud-agent|cloudAgent|cloud agents|cloud_agent" src\app\api`
- `(Get-ChildItem src\domain -Filter *.ts).Count`
- `rg --files src\lib\memory src\lib\skills src\lib\evals src\lib\guardrails`
- `rg -n "CREATE TABLE|memories|memory_fts|fts5|memory_vec|qdrant|Qdrant|vector|embedding|storeMemory|searchMemories|inject|extract|summarize" src\lib\memory src\lib\db\migrations\015_create_memories.sql src\lib\db\migrations\022_add_memory_fts5.sql src\lib\db\migrations\083_memory_vec.sql src\lib\db\memoryVec.ts`
- `rg -n "CREATE TABLE|skills|skill_executions|sandbox|execute|registry|custom|builtin|intercept|inject|timeout|spawn|worker" src\lib\skills src\lib\db\migrations\016_create_skills.sql src\lib\db\migrations\027_skill_mode_and_metadata.sql src\lib\db\skills.ts`
- `rg -n "Eval|eval|suite|combo|model|run|target|CREATE TABLE|eval_runs|eval_suites" src\lib\evals src\lib\db\evals.ts src\lib\db\migrations\030_create_eval_runs.sql src\lib\db\migrations\031_create_eval_suites.sql docs\frameworks\EVALS.md`
- `rg -n "Webhook|webhook|HMAC|signature|retry|backoff|disable|event|deliver|CREATE TABLE|webhook_deliveries" src\lib\webhookDispatcher.ts src\lib\db\webhooks.ts src\lib\db\webhookDeliveries.ts src\lib\db\migrations\011_webhooks.sql src\lib\db\migrations\069_webhook_deliveries.sql src\lib\db\migrations\070_webhooks_kind_metadata.sql docs\frameworks\WEBHOOKS.md`
- `(Select-String -Path src\lib\webhooks\eventDescriptions.ts -Pattern '^  \| "').Count`
- `git status --short`
- `git rev-parse --abbrev-ref HEAD`
