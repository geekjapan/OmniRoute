# Packet P1 API, Streaming, Executors, Routing

Scope: `http-api-authz`, `streaming-core`, `executors-translators`, and
`routing-resilience` from the Rust migration handoff.

This is a planning assessment only. No production-code changes are part of this packet.

## Source Snapshot

- Runtime stack is Node/ESM with `node >=22.0.0 <23 || >=24.0.0 <27`
  (`package.json:46`) plus Next.js, Zod, better-sqlite3, Tailwind, and TypeScript
  (`package.json:229`, `package.json:256`, `package.json:260`, `package.json:302`,
  `package.json:304`).
- Owned source size is substantial: `src/app/api/v1` has 90 files / 10,572 lines,
  `src/server/authz` has 11 files / 1,250 lines, `open-sse/handlers` has 20 files /
  18,085 lines, `open-sse/executors` has 63 files / 34,237 lines,
  `open-sse/translator` has 34 files / 10,593 lines, and `open-sse/services` has
  287 files / 62,308 lines.
- Key hotspot sizes: `open-sse/handlers/chatCore.ts` is 5,821 lines,
  `open-sse/services/combo.ts` is 5,276 lines, `open-sse/executors/base.ts` is
  1,213 lines, and `open-sse/transformer/responsesTransformer.ts` is 577 lines.
- Source of truth for routing strategies is `ROUTING_STRATEGY_VALUES`, currently 15
  entries including `reset-window` (`src/shared/constants/routingStrategies.ts:1`).
  Some checked-in docs still say 14 strategies (`docs/routing/AUTO-COMBO.md:131`),
  so source constants should drive the migration backlog.
- Provider-count docs currently say 226 (`docs/reference/PROVIDER_REFERENCE.md:13`),
  while a source-map count command found 234 top-level entries across provider maps.
  Treat provider count as volatile until the generated provider reference is refreshed.

## Subsystem: http-api-authz

current_stack:

- Next.js App Router endpoints under `src/app/api/v1`; examples delegate to shared
  handlers after CORS and request shaping, such as `/chat/completions` calling
  `handleChat` (`src/app/api/v1/chat/completions/route.ts:31`,
  `src/app/api/v1/chat/completions/route.ts:69`) and `/responses` using early SSE
  keepalive when the client accepts `text/event-stream`
  (`src/app/api/v1/responses/route.ts:68`, `src/app/api/v1/responses/route.ts:82`).
- Central request authz is not route-local only: `src/proxy.ts:5` calls
  `runAuthzPipeline`, which classifies routes (`src/server/authz/classify.ts:45`),
  maps `PUBLIC | CLIENT_API | MANAGEMENT` (`src/server/authz/types.ts:20`), then
  evaluates the matching policy (`src/server/authz/pipeline.ts:193`,
  `src/server/authz/pipeline.ts:207`, `src/server/authz/pipeline.ts:270`).
- Policy split is explicit: `clientApiPolicy` (`src/server/authz/policies/clientApi.ts:35`),
  `managementPolicy` (`src/server/authz/policies/management.ts:92`), and
  `publicPolicy` (`src/server/authz/policies/public.ts:4`).
- Local-only route guard is a security boundary for spawn-capable surfaces
  (`src/server/authz/routeGuard.ts:28`, `src/server/authz/routeGuard.ts:161`).
- Prompt-injection guard clones and parses mutating requests, blocks on guardrail
  decisions, and is applied both generically and inline in chat routes
  (`src/middleware/promptInjectionGuard.ts:22`, `src/middleware/promptInjectionGuard.ts:52`,
  `src/app/api/v1/chat/completions/route.ts:47`, `src/app/api/v1/chat/completions/route.ts:50`).

rust_targets:

| crate_or_tool                                 | purpose                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `axum` or `actix-web`                         | HTTP routing, route extraction, request/response lifecycle.        |
| `tower` + `tower-http`                        | Authz middleware stack, CORS, body-size guard, tracing layers.     |
| `serde`, `serde_json`, `garde` or `validator` | Replace Zod request validation with typed validation.              |
| `jsonwebtoken`, `cookie`, `time`              | Dashboard session cookie/JWT handling.                             |
| `tracing`, `tracing-subscriber`               | Structured logs and request correlation replacing pino-style flow. |
| `utoipa` or `schemars`                        | Optional OpenAPI/schema generation parity for route contracts.     |

complexity: high

key_tasks:

- Define a Rust route classification table that mirrors `classifyRoute`, aliases, public
  allowlists, local-only tiers, always-protected tiers, and fail-closed defaults.
- Port `runAuthzPipeline` as middleware that strips trusted auth headers, stamps route
  class/request id/auth subject headers, handles preflight, enforces body size, and
  redirects dashboard pages consistently.
- Port client API key, dashboard session, management bearer, local CLI token, WS bridge,
  and local-only/private-LAN branches as separate policies with tests.
- Convert per-route Zod and ad hoc body validation to `serde` DTOs plus validation; keep
  compatibility for routes that currently pass raw bodies to `open-sse`.
- Port prompt-injection guard as a middleware/handler wrapper without consuming request
  bodies needed downstream.
- Build route-class conformance tests from the current `tests/unit/authz` shape before
  switching traffic.

risks:

| risk                                                           | severity | mitigation                                                                                                                                            |
| -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fail-open authz regression on an unclassified route.           | high     | Generate a route inventory from `src/app/api` and assert every Rust route class matches TS classification; default unknown routes to management.      |
| Local-only bypass for spawn-capable endpoints.                 | critical | Port `isLocalOnlyPath` before exposing management routes; add loopback/private-LAN/remote tests for every local-only prefix and pattern.              |
| Request body consumed by guard middleware before handler code. | high     | Use buffered body extraction with re-insertion, or typed extractors at handler boundaries; add tests for chat, responses, multipart, and file routes. |
| Next.js dashboard/backend coupling remains unclear.            | medium   | Keep React/Next dashboard initially and put Rust behind a gateway or sidecar; migrate route families incrementally.                                   |
| Divergent CORS/preflight behavior breaks IDE clients.          | medium   | Snapshot CORS headers for `/v1/*`, `/responses`, `/messages`, and VS Code/Ollama-compatible routes.                                                   |

blockers:

- Rust backend boundary decision: replace Next API routes directly or run a Rust gateway in
  front while keeping Next for dashboard/UI.
- Shared auth store and key validation need the database packet's Rust DB layer or a
  stable FFI/process API to the existing DB modules.
- Validation-shared packet must decide the schema source of truth so route DTOs do not
  drift from current Zod schemas.

depends_on:

- validation-shared
- database
- security-stealth
- frontend-dashboard decision
- testing-quality-cicd

effort_person_weeks: 8-12

notes:

- This subsystem is narrower than the full API surface because most model-serving behavior
  delegates into `open-sse`; the hard part is preserving authz classification and guard
  semantics, not just declaring routes.
- Keep as a first migration slice only if traffic is still delegated to the existing TS
  handlers or to already-ported streaming/executor services.

## Subsystem: streaming-core

current_stack:

- Core chat request flow is centered in `handleChatCore`
  (`open-sse/handlers/chatCore.ts:1541`), which imports stream transforms, stream readiness,
  disconnect piping, response sanitization, usage tracking, memory/skills, rate limits,
  compression, and translators (`open-sse/handlers/chatCore.ts:1`,
  `open-sse/handlers/chatCore.ts:10`, `open-sse/handlers/chatCore.ts:14`,
  `open-sse/handlers/chatCore.ts:19`, `open-sse/handlers/chatCore.ts:22`,
  `open-sse/handlers/chatCore.ts:96`, `open-sse/handlers/chatCore.ts:176`).
- SSE response headers and in-band error framing are hand-built
  (`open-sse/handlers/chatCore.ts:643`, `open-sse/handlers/chatCore.ts:1115`,
  `open-sse/handlers/chatCore.ts:1124`).
- Stream mode is inferred from body, Accept header, endpoint format, and API-key settings
  (`open-sse/handlers/chatCore.ts:2288`).
- Responses API streaming is a separate transform path: Responses bodies are converted,
  forced to stream, sent through `handleChatCore`, then piped through
  `createResponsesApiTransformStream` (`open-sse/handlers/responsesHandler.ts:39`,
  `open-sse/handlers/responsesHandler.ts:42`, `open-sse/handlers/responsesHandler.ts:45`,
  `open-sse/handlers/responsesHandler.ts:72`, `open-sse/handlers/responsesHandler.ts:86`).
- The Responses transformer emits `event:` / `data:` frames, keepalive comments, deltas,
  completed events, and final `[DONE]` (`open-sse/transformer/responsesTransformer.ts:79`,
  `open-sse/transformer/responsesTransformer.ts:111`,
  `open-sse/transformer/responsesTransformer.ts:325`,
  `open-sse/transformer/responsesTransformer.ts:329`,
  `open-sse/transformer/responsesTransformer.ts:461`,
  `open-sse/transformer/responsesTransformer.ts:570`).
- Early keepalive can commit an SSE response before the upstream first byte
  (`open-sse/utils/earlyStreamKeepalive.ts:16`, `open-sse/utils/earlyStreamKeepalive.ts:21`,
  `open-sse/utils/earlyStreamKeepalive.ts:85`, `open-sse/utils/earlyStreamKeepalive.ts:187`).
- Non-chat handlers cover embeddings, images, audio speech/transcription, video, music,
  moderation, rerank, and search (`open-sse/handlers/embeddings.ts:41`,
  `open-sse/handlers/imageGeneration.ts:261`, `open-sse/handlers/audioSpeech.ts:837`,
  `open-sse/handlers/audioTranscription.ts:420`, `open-sse/handlers/videoGeneration.ts:40`,
  `open-sse/handlers/musicGeneration.ts:78`, `open-sse/handlers/moderations.ts:20`,
  `open-sse/handlers/rerank.ts:74`, `open-sse/handlers/search.ts:1197`).

rust_targets:

| crate_or_tool                                        | purpose                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tokio`                                              | Async runtime, cancellation, timers, IO.                                     |
| `axum::response::sse` or custom `hyper` body streams | SSE responses with exact framing and headers.                                |
| `futures`, `async-stream`, `tokio-stream`            | Stream adapters, backpressure-aware transforms, fan-in/fan-out.              |
| `bytes`, `http-body-util`, `tokio-util`              | Byte streams, body bridging, codecs.                                         |
| `serde_json`                                         | Incremental event payload parse/emit and non-streaming reconstruction.       |
| `pin-project-lite`                                   | Safe custom stream state machines where simple combinators are insufficient. |

complexity: very_high

key_tasks:

- Specify the canonical stream contract for Chat Completions SSE, Responses API SSE,
  Claude/Gemini provider streams, Ollama-compatible JSON-lines transforms, binary audio,
  and non-streaming JSON fallback.
- Port stream-mode resolution, Accept-header behavior, early keepalive thresholds,
  upstream-start timeouts, stream readiness, and client-disconnect cancellation.
- Port `TransformStream` behavior to Rust stream combinators while preserving event order,
  final snapshot handling, keepalive comments, `[DONE]`, and error-in-band semantics.
- Port non-streaming bridges that consume provider SSE and reconstruct final JSON without
  losing tool calls, usage, reasoning, or response metadata.
- Preserve streaming PII/sanitization behavior, response translation, usage extraction,
  cache token metrics, and reasoning replay capture in both streaming and non-streaming paths.
- Build parity fixtures from current stream tests and add golden raw-byte tests for SSE
  framing, including empty chunks, malformed data, partial UTF-8, tool-call accumulation,
  and client disconnect.
- Treat media handlers separately: audio speech is a binary stream proxy, audio
  transcription is multipart, and image/video/music have long-polling plus provider-specific
  body shapes.

risks:

| risk                                                             | severity | mitigation                                                                                                                                                     |
| ---------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSE byte-level incompatibility with OpenAI/Codex/IDE clients.    | critical | Golden tests for exact event names, `data:` payloads, blank-line frame boundaries, keepalives, and `[DONE]`; replay captured streams through both TS and Rust. |
| Web Streams semantics do not map one-to-one to Rust streams.     | high     | Implement a small internal stream abstraction and conformance tests for cancellation, backpressure, reader cancel, and transform finalization.                 |
| Responses API transform loses event ordering or final snapshots. | high     | Port `responsesTransformer.ts` with fixture-driven tests for `response.output_text.delta`, `response.completed`, and final `data: [DONE]`.                     |
| Buffering to validate or bridge streams causes memory growth.    | high     | Keep bounded peeks only; add heap/soak tests equivalent to the existing resilience notes.                                                                      |
| Cross-cutting features are silently skipped.                     | high     | Integration tests must assert compression stats, usage, cache, reasoning replay, response sanitizer, and PII transform still run on streaming paths.           |

blockers:

- Executor trait must return a typed stream/body abstraction before streaming-core can be
  completed.
- Translator/response-transform parity must be available for non-OpenAI provider streams.
- Compression and usage DB writes need either the Rust data layer or a compatibility bridge.

depends_on:

- executors-translators
- routing-resilience
- validation-shared
- database and usage accounting
- security-stealth and error sanitization
- testing-quality-cicd

effort_person_weeks: 16-24

notes:

- Streaming should be migrated with a shadow/replay harness before any live cutover. The
  risk is not throughput; it is tiny compatibility details that clients rely on.
- Do not start by porting all handlers. Start with chat streaming and Responses transform,
  then add media/search after the shared body/stream primitives are stable.

## Subsystem: executors-translators

current_stack:

- Executor abstraction is centered on `BaseExecutor`, with overridable `buildUrl`,
  `buildHeaders`, `transformRequest`, token counting, and `execute`
  (`open-sse/executors/base.ts:349`, `open-sse/executors/base.ts:402`,
  `open-sse/executors/base.ts:428`, `open-sse/executors/base.ts:484`,
  `open-sse/executors/base.ts:585`, `open-sse/executors/base.ts:641`).
- `execute` builds request state, merges upstream extra headers, calls `fetch`, and has
  intra-URL 429 retry behavior (`open-sse/executors/base.ts:751`,
  `open-sse/executors/base.ts:768`, `open-sse/executors/base.ts:1146`,
  `open-sse/executors/base.ts:1157`, `open-sse/executors/base.ts:1175`).
- `DefaultExecutor` handles most OpenAI-compatible providers with provider-registry-backed
  URLs, headers, and request transforms (`open-sse/executors/default.ts:172`,
  `open-sse/executors/default.ts:313`, `open-sse/executors/default.ts:530`).
- `getExecutor` has an explicit map for provider-specific executors and falls back to
  cached `DefaultExecutor` instances (`open-sse/executors/index.ts:56`,
  `open-sse/executors/index.ts:156`, `open-sse/executors/index.ts:158`).
- Translator formats are registered around OpenAI, OpenAI Responses, Claude, Gemini,
  Gemini CLI, Antigravity, Kiro, and Cursor (`open-sse/translator/formats.ts:2`);
  request and response translators register pairwise conversions
  (`open-sse/translator/registry.ts:20`, `open-sse/translator/request/openai-to-claude.ts:743`,
  `open-sse/translator/request/openai-to-gemini.ts:814`,
  `open-sse/translator/request/openai-responses.ts:733`,
  `open-sse/translator/response/openai-responses.ts:901`).
- Core translation functions route direct conversions or pivot through OpenAI when needed
  (`open-sse/translator/index.ts:120`, `open-sse/translator/index.ts:172`,
  `open-sse/translator/index.ts:187`, `open-sse/translator/index.ts:207`,
  `open-sse/translator/index.ts:428`).
- Provider registry carries per-model metadata including `targetFormat`
  (`open-sse/config/providerRegistry.ts:54`, `open-sse/config/providerRegistry.ts:111`,
  `open-sse/config/providerRegistry.ts:202`, `open-sse/config/providerRegistry.ts:416`).
- Ollama compatibility exists through API/utility transforms and provider config, not as a
  standalone translator format (`src/app/api/v1/api/chat/route.ts:3`,
  `open-sse/utils/ollamaTransform.ts:11`, `open-sse/config/providerRegistry.ts:3185`).

rust_targets:

| crate_or_tool                         | purpose                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| `reqwest` with selectable TLS backend | Provider HTTP clients, streaming bodies, proxy support.             |
| `hyper` / `hyper-util`                | Lower-level transport path for providers needing custom behavior.   |
| `async-trait` or enum-dispatch        | Executor trait/object model for provider-specific overrides.        |
| `serde`, `serde_json`, `serde_with`   | Provider request/response DTOs and permissive compatibility shapes. |
| `url`, `http`, `headers`              | URL construction and strict header handling.                        |
| `secrecy`, `zeroize`                  | Credentials in memory and logs.                                     |
| `backon` or custom retry module       | Explicit retry/backoff policy with provider-specific overrides.     |
| `insta` or similar snapshot tests     | Golden translator and executor payload parity tests.                |

complexity: very_high

key_tasks:

- Design a Rust `Executor` trait that covers URL building, headers, body transform,
  token-count endpoint, upstream streaming response, retry metadata, and provider-specific
  side effects.
- Port `BaseExecutor` semantics first, including timeout/abort, upstream extra headers,
  forbidden custom headers, tool schema sanitization, reasoning effort sanitization,
  stale encoding header stripping, retry/backoff, and sanitized logging.
- Generate or port provider registry data into typed Rust structures; keep provider aliases,
  model `targetFormat`, pricing/capability metadata, and custom provider prefixes.
- Port `DefaultExecutor` for OpenAI-compatible providers, then prioritize custom executors
  used by free/OAuth/web providers and providers with nonstandard auth/session flows.
- Port request/response translators with fixture parity for OpenAI, OpenAI Responses,
  Claude, Gemini, Gemini CLI, Antigravity, Kiro, Cursor, and Ollama compatibility transforms.
- Build a provider conformance harness that sends the same normalized body through TS and
  Rust translators/executors without live secrets, comparing URLs, headers, bodies, stream
  expectations, and retry decisions.
- Decide whether web-cookie/browser-like executors remain in TS initially, run as sidecars,
  or are rewritten in Rust with a compatible browser/session layer.

risks:

| risk                                                                             | severity | mitigation                                                                                                                 |
| -------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Provider quirks are encoded in scattered executor overrides and comments.        | critical | Build a generated inventory of executor overrides and translator registrations; port by provider family with golden tests. |
| Retry/backoff parity changes account fallback and cost.                          | high     | Preserve BaseExecutor 429 intra-retry and provider-specific retry hints; assert backoff decisions in tests.                |
| Header/auth differences leak credentials or break upstreams.                     | high     | Reuse a single Rust header sanitizer equivalent to `upstreamHeaders.ts`; test auth, hop-by-hop, and custom headers.        |
| TLS/fingerprint behavior differs from Node/fetch or current custom clients.      | high     | Defer stealth-sensitive executors to TS sidecars until the security-stealth packet proves Rust transport parity.           |
| Translators silently corrupt tool calls, reasoning, images, or Responses fields. | high     | Snapshot complete request/response bodies and streamed chunks for each format pair.                                        |
| Provider count and generated catalog drift.                                      | medium   | Treat provider catalog generation as an input artifact; refresh docs/reference before using counts in public docs.         |

blockers:

- Security-stealth decision for TLS/JA3-sensitive providers and web-session providers.
- Database/credential access layer for OAuth tokens, API keys, provider-specific data, and
  custom headers.
- Streaming-core body/stream abstraction and cancellation model.
- Testing-quality-cicd fixtures for translator/executor parity.

depends_on:

- streaming-core
- validation-shared
- database and OAuth/credential storage
- security-stealth
- testing-quality-cicd

effort_person_weeks: 30-45

notes:

- This is the largest P1 cost center. A direct big-bang rewrite of all executors is not
  realistic; use a strangler approach where Rust owns `BaseExecutor` plus default
  OpenAI-compatible execution first, while high-quirk web/OAuth executors remain bridged.
- The source tree contains 63 executor files. Even if many providers use `DefaultExecutor`,
  the compatibility burden is driven by the custom executor and translator edge cases.

## Subsystem: routing-resilience

current_stack:

- Combo routing supports the full strategy set in `combo.ts`: priority, weighted,
  round-robin, random, least-used, cost-optimized, reset-aware, reset-window,
  strict-random, auto, fill-first, p2c, lkgp, context-optimized, and context-relay
  (`open-sse/services/combo.ts:3`, `src/shared/constants/routingStrategies.ts:1`).
- `handleComboChat` normalizes strategy, wraps single-model calls with timeout/cancel
  behavior, resolves targets, and reorders by strategy (`open-sse/services/combo.ts:3116`,
  `open-sse/services/combo.ts:3128`, `open-sse/services/combo.ts:3200`,
  `open-sse/services/combo.ts:3294`, `open-sse/services/combo.ts:3310`,
  `open-sse/services/combo.ts:3554`, `open-sse/services/combo.ts:3604`,
  `open-sse/services/combo.ts:3674`, `open-sse/services/combo.ts:3686`).
- `resolveComboTargets` expands combo config and nested targets
  (`open-sse/services/combo.ts:2937`).
- Combo stream validation uses bounded peeks for event streams so validation does not
  de-stream successful responses (`open-sse/services/combo.ts:508`,
  `open-sse/services/combo.ts:523`, `open-sse/services/combo.ts:647`).
- Auto-combo uses variants and live provider connections, with candidate pool generation
  from active connections and registry models (`open-sse/services/autoCombo/autoPrefix.ts:1`,
  `open-sse/services/autoCombo/virtualFactory.ts:206`,
  `open-sse/services/autoCombo/virtualFactory.ts:209`,
  `open-sse/services/autoCombo/virtualFactory.ts:294`).
- Auto scoring currently has 9 weights in source: quota, health, costInv, latencyInv,
  taskFit, stability, tierPriority, tierAffinity, and specificityMatch
  (`open-sse/services/autoCombo/scoring.ts:41`,
  `open-sse/services/autoCombo/scoring.ts:50`).
- Resilience spans provider circuit breakers, connection cooldowns, model lockouts,
  rate-limit manager queues, and round-robin semaphores
  (`src/shared/utils/circuitBreaker.ts:84`, `open-sse/services/accountFallback.ts:442`,
  `open-sse/services/accountFallback.ts:814`, `open-sse/services/accountFallback.ts:1218`,
  `open-sse/services/rateLimitManager.ts:522`, `open-sse/services/rateLimitManager.ts:708`,
  `open-sse/services/rateLimitSemaphore.ts:119`, `open-sse/services/rateLimitSemaphore.ts:167`).
- Provider profiles configure rate-limit cooldowns, circuit thresholds, reset windows,
  degradation thresholds, and backoff escalation (`open-sse/config/constants.ts:166`,
  `open-sse/config/constants.ts:171`, `open-sse/config/constants.ts:178`,
  `open-sse/config/constants.ts:186`, `open-sse/config/constants.ts:203`).
- Compression is integrated into chat and combo attempts: `handleChatCore` selects and
  applies compression before provider dispatch (`open-sse/handlers/chatCore.ts:2363`,
  `open-sse/handlers/chatCore.ts:2391`, `open-sse/handlers/chatCore.ts:2637`), while
  combo attempts can apply compression overrides (`open-sse/services/combo.ts:3968`).
- Compression modes and engines include legacy modes plus `rtk`, `stacked`, `headroom`,
  `ccr`, and `llmlingua` (`open-sse/services/compression/types.ts:12`,
  `open-sse/services/compression/types.ts:30`,
  `open-sse/services/compression/engines/index.ts:11`,
  `open-sse/services/compression/engines/index.ts:17`).

rust_targets:

| crate_or_tool                               | purpose                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `tokio::sync`, `Arc`, `RwLock`, `Semaphore` | Request-scoped cancellation, round-robin/concurrency gates, shared runtime state. |
| `dashmap`                                   | Concurrent provider/circuit/cooldown/rate-limit maps.                             |
| `moka`                                      | TTL caches for combos, provider metadata, scoring inputs, and session state.      |
| `governor` or custom limiter                | Rate-limit queues, learned limits, and per-provider/model throttling.             |
| `rand`, `rand_distr`                        | Weighted/random/p2c/strict-random ordering.                                       |
| `serde`, `schemars`                         | Typed combo/routing/compression configs.                                          |
| `regex`, `serde_json`, `aho-corasick`       | Deterministic compression filters and rule matching.                              |
| `tracing` + metrics crate                   | Per-attempt routing traces, fallback reasons, breaker/cooldown telemetry.         |

complexity: very_high

key_tasks:

- Extract routing strategy behavior into a Rust strategy interface with deterministic tests
  for all 15 `ROUTING_STRATEGY_VALUES`.
- Port target resolution, nested combos, target quality validation, bounded stream peeking,
  context-relay handoff, pinned-context routing, and round-robin semaphore behavior.
- Port auto-combo scoring, mode packs, virtual factory, router strategies
  (`rules`, `cost`, `latency`, `sla-aware`, `lkgp`), exploration, and soft quota penalties.
- Port resilience as three independent scopes: provider circuit breaker, connection
  cooldown, and provider+connection+model lockout. Preserve lazy recovery behavior and
  do not collapse all failures into one breaker.
- Port `rateLimitManager` queue/drop/watchdog behavior and rate-limit semaphore behavior
  without blocking hot-path routing.
- Port compression selection, built-in engine registry, stacked pipelines, RTK filter DSL,
  validation, stats, and combo/default compression assignment. Treat ML/worker engines such
  as `llmlingua` as optional bridges until Rust equivalents are decided.
- Define observability events for each attempt: selected target, fallback reason, retry
  hint, cooldown/lockout updates, compression result, and final success/failure.

risks:

| risk                                                                                       | severity | mitigation                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Strategy ordering changes cause different costs, quota burn, or user-visible model choice. | high     | Golden tests for every strategy using fixed candidate pools, RNG seeds, quotas, resets, and context sizes.                                 |
| Resilience scopes collapse into one mechanism.                                             | critical | Model provider breaker, connection cooldown, and model lockout as separate state machines with separate tests.                             |
| Streaming validation buffers too much or consumes the body.                                | high     | Keep bounded peek/replay semantics and test event-stream pass-through under success, empty stream, and malformed stream.                   |
| Auto-combo scoring drifts due to stale docs or weight changes.                             | medium   | Source-generate Rust weights from `scoring.ts` or a shared manifest; assert all weights and strategy values.                               |
| Compression changes prompt semantics or drops technical tokens.                            | high     | Port validation rules first; run corpus/fixture comparisons for lite, caveman, RTK, stacked, headroom, CCR, and llmlingua bridge behavior. |
| Rate-limit queues leak timers or wedge under 429 storms.                                   | high     | Recreate watchdog/queue-drop tests; add long-running soak tests before cutover.                                                            |

blockers:

- Database packet must provide combo, connection, quota, compression settings, and
  analytics persistence APIs.
- Executor/streaming packets must expose cancellable single-model attempts and replayable
  stream peeks.
- Compression engine strategy must decide which engines are native Rust, which remain TS,
  and which are optional.
- Metrics/logging conventions need a Rust `tracing` schema compatible with current
  dashboards and debugging workflows.

depends_on:

- database
- executors-translators
- streaming-core
- validation-shared
- domain-extras for policy/cost/quota semantics
- testing-quality-cicd

effort_person_weeks: 18-28

notes:

- Routing-resilience should not be ported as one monolith. Start by defining typed
  strategy and state-machine contracts, then port the simplest strategy path and layer
  auto-combo/resilience/compression behind feature flags.
- The source-confirmed 15 strategy count should be used for Rust parity. The older
  Auto-Combo doc count is stale and should not drive implementation scope.

## Combined Risk Summary

- Overall feasibility: a strangler migration is feasible; a big-bang rewrite of this P1
  packet is not. The practical path is Rust gateway plus sidecar/FFI/process boundaries,
  then native Rust ports of hot paths with shadow traffic and golden fixtures.
- Critical path: `executors-translators` and `streaming-core`. Routing cannot be safely
  cut over until single-model attempts expose cancellable streams and exact response
  transforms.
- Highest user-visible risk: SSE/Responses parity. Small differences in keepalive timing,
  event names, final snapshots, `[DONE]`, and tool-call deltas can break Codex, IDEs, and
  OpenAI-compatible clients.
- Highest operational risk: provider behavior parity. Custom executors encode upstream
  quirks, retry/backoff, OAuth/web-session behavior, and target-format decisions across a
  large provider catalog.
- Highest security risk: authz/local-only route classification and upstream header/auth
  handling. These must be ported as conformance-tested primitives before new Rust routes
  are exposed.
- Highest data/state risk: resilience state semantics. Provider breaker, account cooldown,
  model lockout, rate-limit queues, and compression analytics are intentionally separate;
  flattening them would change runtime behavior.
- Recommended sequencing:
  1. Build schema/config/codegen inventory and golden fixture harness.
  2. Port authz classifier/policies in front of TS handlers.
  3. Port BaseExecutor + DefaultExecutor with translator fixtures.
  4. Port chat streaming and Responses transformer with byte-level SSE tests.
  5. Port minimal priority/weighted combo routing.
  6. Add resilience state machines and rate-limit queues.
  7. Add auto-combo and compression engines behind flags.
  8. Shadow/replay traffic, compare responses, then cut over provider families.
- Rough P1 effort total: 72-109 person-weeks before broader database, UI, security-stealth,
  and CI migration work. The range assumes a small experienced team and fixture-driven
  migration, not a rewrite from memory.

## Verification Evidence

Commands run from `C:\Users\geekjapan\.codex\worktrees\8f13\OmniRoute-rust-roadmap-p1`
unless an absolute path is shown:

```powershell
Get-Content -Raw -LiteralPath AGENTS.md
if (Test-Path -LiteralPath CLAUDE.md) { Get-Content -Raw -LiteralPath CLAUDE.md }
Get-Content -Raw -LiteralPath D:\dev\OmniRoute\docs\handoff.md
```

```powershell
git status --short --branch
git rev-parse HEAD
git branch --show-current
```

```powershell
Get-ChildItem -Recurse -File -Name src/app/api/v1,src/server/authz,src/middleware,open-sse/handlers,open-sse/transformer,open-sse/executors,open-sse/translator,open-sse/services/compression | Sort-Object
```

```powershell
$paths = @('src/app/api/v1','src/server/authz','open-sse/handlers','open-sse/transformer','open-sse/executors','open-sse/translator','open-sse/services','open-sse/services/compression'); foreach ($p in $paths) { if (Test-Path $p) { $files = Get-ChildItem -LiteralPath $p -Recurse -File | Where-Object { $_.Extension -in '.ts','.tsx','.js','.mjs','.json' }; $loc = ($files | ForEach-Object { (Get-Content -LiteralPath $_.FullName -ErrorAction SilentlyContinue).Count } | Measure-Object -Sum).Sum; [pscustomobject]@{Path=$p; Files=$files.Count; Lines=$loc} } }
```

```powershell
$files = @('open-sse/handlers/chatCore.ts','open-sse/executors/base.ts','open-sse/services/combo.ts','open-sse/translator/index.ts','open-sse/transformer/responsesTransformer.ts','src/server/authz/pipeline.ts','src/server/authz/classify.ts','src/server/authz/routeGuard.ts','open-sse/services/accountFallback.ts','open-sse/services/compression/types.ts'); foreach ($f in $files) { [pscustomobject]@{File=$f; Lines=(Get-Content -LiteralPath $f).Count} }
```

```powershell
Get-Content -Raw -LiteralPath src/shared/constants/routingStrategies.ts
```

```powershell
$file='src/shared/constants/providers.ts'; $lines=Get-Content -LiteralPath $file; $sections=@('NOAUTH_PROVIDERS','OAUTH_PROVIDERS','APIKEY_PROVIDERS','WEB_COOKIE_PROVIDERS','LOCAL_PROVIDERS','SEARCH_PROVIDERS','AUDIO_ONLY_PROVIDERS','UPSTREAM_PROXY_PROVIDERS','CLOUD_AGENT_PROVIDERS','SYSTEM_PROVIDERS'); $total=0; foreach($name in $sections){ $start=($lines | Select-String -Pattern "^export const $name = \{" | Select-Object -First 1).LineNumber; $count=0; if($start){ for($i=$start; $i -lt $lines.Count; $i++){ if($i -gt $start -and $lines[$i-1] -match '^};'){ break }; if($lines[$i-1] -match '^  ("[^"]+"|[A-Za-z0-9_-]+): \{'){ $count++ } } }; $total += $count; [pscustomobject]@{Section=$name; Count=$count} }; [pscustomobject]@{Section='TOTAL'; Count=$total}
```

```powershell
rg -n "classifyRoute|runAuthzPipeline|POLICIES|PUBLIC|CLIENT_API|MANAGEMENT|isLocalOnlyPath|LOCAL_ONLY|ALWAYS_PROTECTED|assertAuth|clientApiPolicy|managementPolicy|publicPolicy" src/server/authz src/proxy.ts src/shared/constants/publicApiRoutes.ts src/shared/utils/apiAuth.ts
```

```powershell
rg -n "createSSETransformStreamWithLogger|ensureStreamReadiness|createStreamController|pipeWithDisconnect|createPiiSseTransform|Content-Type.: .text/event-stream|data: \[DONE\]|resolveStreamFlag|compressContext|selectCompressionStrategy|executeWithUpstreamStartTimeout|translateRequest\(|translateResponse\(|getExecutor\(|executor.execute|handleComboChat\(" open-sse/handlers/chatCore.ts open-sse/handlers/responsesHandler.ts open-sse/transformer/responsesTransformer.ts open-sse/handlers/sseParser.ts
```

```powershell
rg -n "export class BaseExecutor|static RETRY_CONFIG|buildUrl\(|buildHeaders\(|transformRequest\(|async execute\(|fetch\(|429 intra-retry|Retry-After|backoff|sanitize|upstreamExtraHeaders|abort|signal" open-sse/executors/base.ts open-sse/executors/default.ts open-sse/executors/index.ts src/shared/constants/upstreamHeaders.ts
```

```powershell
rg -n "register\(|FORMATS\.OPENAI|FORMATS\.OPENAI_RESPONSES|FORMATS\.CLAUDE|FORMATS\.GEMINI|FORMATS\.CURSOR|FORMATS\.ANTIGRAVITY|FORMATS\.KIRO|FORMATS\.OLLAMA" open-sse/translator/request open-sse/translator/response open-sse/translator/formats.ts open-sse/translator/registry.ts
```

```powershell
rg -n "handleComboChat|resolveComboTargets|handleSingleModel|normalizeRoutingStrategy|ROUTING_STRATEGY_VALUES|strategy|reset-aware|reset-window|context-relay|isProviderBlocked|recordProviderFailure|lockModelIfPerModelQuota|checkFallbackError|select.*Target|weighted|round-robin|p2c|lkgp|auto" open-sse/services/combo.ts src/shared/constants/routingStrategies.ts
```

```powershell
rg -n "export const DEFAULT_WEIGHTS|validateWeights|scorePool|health|quota|costInv|latencyInv|taskFit|specificityMatch|tierAffinity|createVirtualAutoCombo|parseAutoPrefix|registerStrategy|class .*Strategy|AUTO_ROUTING_STRATEGY_VALUES" open-sse/services/autoCombo src/shared/constants/routingStrategies.ts
```

```powershell
rg -n "type CompressionMode|DEFAULT_COMPRESSION_CONFIG|compressionComboId|stackedPipeline|cavemanConfig|rtkConfig|applyCompressionAsync|applyStackedCompressionAsync|registerBuiltinCompressionEngines|registerCompressionEngine|validateCompression|llmlingua|headroom|ccr" open-sse/services/compression/types.ts open-sse/services/compression/strategySelector.ts open-sse/services/compression/engines/index.ts open-sse/services/compression/engines/registry.ts open-sse/services/compression/validation.ts
```

```powershell
rg -n "ollama|Ollama|FORMATS\.OLLAMA|targetFormat.*ollama" open-sse src/shared src/app/api/v1
```

```powershell
rg -n "graphify|GRAPH_REPORT|rust|migration|roadmap|Packet|P1|http-api-authz|streaming-core|executors-translators|routing-resilience" D:\dev\OmniRoute\docs\handoff.md . -g "!node_modules" -g "!dist" -g "!.build"
```

Post-write checks:

```powershell
Test-Path -LiteralPath .workflow/rust-migration-roadmap/results/P1-api-streaming-routing.md
(Get-Content -LiteralPath .workflow/rust-migration-roadmap/results/P1-api-streaming-routing.md).Count
rg -n "^## Subsystem:|^current_stack:|^rust_targets:|^complexity:|^key_tasks:|^risks:|^blockers:|^depends_on:|^effort_person_weeks:|^notes:|^## Combined Risk Summary|^## Verification Evidence" .workflow/rust-migration-roadmap/results/P1-api-streaming-routing.md
git status --short --branch
git -C C:\Users\geekjapan\.codex\worktrees\8f13\OmniRoute status --short --branch
Get-ChildItem -Recurse -File -LiteralPath .workflow/rust-migration-roadmap/results | Select-Object -ExpandProperty FullName
git status --short --untracked-files=all
git diff -- .workflow/rust-migration-roadmap/results/P1-api-streaming-routing.md
```

Notable verification result: `node --import tsx/esm ...` was attempted to import
`providers.ts` directly, but this worktree does not have a local `tsx` package installed
(`ERR_MODULE_NOT_FOUND`). I did not install dependencies; provider-map counting was done from
source text instead.
