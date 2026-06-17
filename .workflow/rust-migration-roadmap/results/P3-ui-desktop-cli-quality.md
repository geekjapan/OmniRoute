# P3 UI, Desktop, CLI, Quality - Rust Migration Assessment

Packet scope: `frontend-dashboard`, `electron-desktop`, `cli-bootstrap-services`,
`testing-quality-cicd`.

Source handoff read: `docs/handoff.md`. This is an analysis result only;
no production-code changes were made.

## Evidence Baseline

- Current branch/worktree: `feature/rust-roadmap-ui-desktop-quality` in
  `<packet-worktree-P3>`.
- Node runtime range is `>=22.0.0 <23 || >=24.0.0 <27` (`package.json:46`).
- The app is an ES module package with CLI binaries `omniroute` and
  `omniroute-reset-password` (`package.json:5`, `package.json:6`).
- Next uses `next-intl` via `createNextIntlPlugin`, a custom `.build/next` `distDir`,
  and standalone output (`next.config.mjs:1`, `next.config.mjs:6`,
  `next.config.mjs:7`, `next.config.mjs:93`).
- Verified counts from filesystem:
  - 49 direct dashboard directories, 99 dashboard `page.tsx` files, 571 dashboard
    TS/TSX files.
  - 101 shared component TS/TSX files.
  - 42 web i18n message JSON files and 42 CLI locale JSON files.
  - 14 Electron workspace files.
  - 157 CLI `.mjs`/`.ts`/`.jsx` files.
  - 15 embedded-service files.
  - 18 GitHub workflow YAML files, 46 `scripts/check` scripts, 4 `scripts/quality`
    scripts.
  - 1,884 files under `tests/`, including 1,794 matching `*.test.*` / `*.spec.ts`
    files.

## frontend-dashboard

current_stack:

- Next.js 16 App Router, React 19, `next-intl`, Tailwind v4, Monaco, React Flow, Recharts,
  lucide/material icons (`package.json:229`, `package.json:230`, `package.json:240`,
  `package.json:271`, `package.json:302`, `package.json:196`, `package.json:200`,
  `package.json:245`).
- Dashboard shell is React-client heavy: `DashboardLayout` wraps the dashboard route
  group (`src/app/(dashboard)/layout.tsx:1`, `src/shared/components/layouts/DashboardLayout.tsx:16`),
  and the sidebar uses `next-intl` translations plus persistent user settings
  (`src/shared/components/Sidebar.tsx:68`, `src/shared/components/Sidebar.tsx:124`).
- Route/navigation surface is large and config-driven: `SIDEBAR_SECTIONS` is the central
  nav definition (`src/shared/constants/sidebarVisibility.ts:858`) with many concrete
  `/dashboard/*` hrefs such as providers, CLI tools, analytics, MCP/A2A, memory, plugins,
  and settings (`src/shared/constants/sidebarVisibility.ts:189`,
  `src/shared/constants/sidebarVisibility.ts:343`,
  `src/shared/constants/sidebarVisibility.ts:624`,
  `src/shared/constants/sidebarVisibility.ts:759`).
- i18n uses generated locale metadata and dynamic JSON message loading, then deep-merges
  fallback English/default locale namespaces (`src/i18n/config.ts:26`,
  `src/i18n/request.ts:112`, `src/i18n/request.ts:120`,
  `src/i18n/request.ts:135`).

rust_targets:

- Recommended: keep the React/Next dashboard as the frontend during the Rust backend
  migration. Use Rust for API/backend services, not for this UI in the early roadmap.
- `axum`/`tower-http` static serving or reverse proxy: serve the existing dashboard build
  from the Rust gateway when the backend is ready.
- `utoipa`/OpenAPI plus generated TypeScript clients: make Rust API changes visible to
  dashboard code without rewriting the UI.
- Optional later alternative: Leptos or Dioxus only for a full UI rewrite after backend
  parity; not a P3-critical path.

complexity: very_high if rewritten in Rust/WASM; medium-high if kept as React and pointed
at a Rust API.

key_tasks:

- Freeze the frontend decision: keep React/Next as the primary dashboard, with a typed
  API contract to Rust services.
- Inventory dashboard API calls and SSE/streaming usage before swapping backend routes.
- Preserve i18n behavior: 42 locales, fallback merge semantics, `__MISSING__` placeholder
  policy, and the UI coverage gate.
- Keep existing component libraries rather than rebuilding Monaco, React Flow, charts, and
  large form flows in WASM.
- Add contract tests for dashboard-critical endpoints before any Rust route replacement.
- Define a static asset serving plan for production builds, Electron/Tauri bundles, Docker,
  and VPS deploys.

risks:

- very_high: Full Rust/WASM UI rewrite would dominate the migration and delay backend
  parity. Mitigation: explicitly classify the dashboard as retained React until a later
  product-driven rewrite.
- high: API drift can silently break many client-heavy pages. Mitigation: generated
  schemas/clients plus Playwright smoke coverage per critical page.
- high: i18n regressions are likely at 42 locales. Mitigation: port or keep
  `check-ui-keys-coverage` and translation-drift checks during backend migration.
- medium: Next standalone/static asset assumptions can conflict with a Rust gateway.
  Mitigation: keep `next build` output as an artifact and serve/proxy it unchanged first.

blockers:

- Operator decision on the meaning of "Rust-based": backend-only first, or dashboard rewrite
  included.
- A stable API contract for the Rust gateway/backends.
- A dashboard endpoint inventory and golden smoke paths for provider setup, playground,
  settings, logs, CLI tools, MCP/A2A, and analytics.

depends_on:

- `http-api-authz`
- `validation-shared`
- `streaming-core`
- `database`
- `routing-resilience`
- `testing-quality-cicd`

effort_person_weeks:

- Keep React with Rust API integration: 8-14 person-weeks.
- Full Leptos/Dioxus-style rewrite: 70-120 person-weeks, before accounting for product
  redesign or i18n retranslation.

notes:

- Blunt recommendation: do not rewrite the dashboard in Rust as part of the core migration.
  The dashboard is too broad, too client-heavy, and too i18n-sensitive. Preserve it and make
  Rust backend cutovers contract-driven.

## electron-desktop

current_stack:

- Separate Electron workspace with Electron 42, `electron-updater`, and `electron-builder`
  (`electron/package.json:28`, `electron/package.json:31`, `electron/package.json:32`).
- Electron build scripts stage the Next standalone bundle, then build Windows, macOS, and
  Linux artifacts (`electron/package.json:18`, `electron/package.json:19`,
  `electron/package.json:20`, `electron/package.json:21`, `electron/package.json:24`).
- Packaging targets include GitHub publish, Windows NSIS/portable, macOS DMG, and Linux
  AppImage/deb (`electron/package.json:46`, `electron/package.json:87`,
  `electron/package.json:95`, `electron/package.json:104`,
  `electron/package.json:111`, `electron/package.json:120`).
- Main process owns BrowserWindow, tray, server lifecycle, updater, autostart, IPC, and
  web-cookie login flows (`electron/main.js:5`, `electron/main.js:34`,
  `electron/main.js:351`, `electron/main.js:624`, `electron/main.js:755`,
  `electron/main.js:835`, `electron/main.js:870`).
- Renderer isolation is intentional: `contextIsolation: true`, `nodeIntegration: false`,
  and a whitelisted preload bridge (`electron/main.js:360`, `electron/main.js:361`,
  `electron/preload.js:103`, `electron/preload.js:138`).

rust_targets:

- `tauri` 2: replacement desktop shell only after backend/API and static dashboard serving
  are stable.
- Tauri updater/signing plugins: parity for `electron-updater` GitHub release behavior.
- Tauri tray/menu/autostart/window plugins: parity for tray, close-to-tray, port switching,
  and autostart.
- Rust process supervisor: eventually launch the Rust server directly instead of spawning
  Next's standalone `server.js`.
- `tauri` Webview windows or OAuth helper windows: parity for cookie-provider login flows.

complexity: high.

key_tasks:

- Build a feature matrix for Electron to Tauri: window controls, tray, updater, autostart,
  login windows, server child lifecycle, CSP/IPC, headless mode, packaging artifacts.
- Keep Electron during early Rust backend migration; switch to Tauri only after the local
  server and dashboard asset strategy are stable.
- Prototype Tauri with the existing React dashboard as static/webview content.
- Preserve updater behavior and release artifact names/platform coverage.
- Port IPC channel names or provide a compatibility shim for `window.electronAPI`.
- Recreate packaged smoke testing around the new desktop binary.

risks:

- high: Tauri parity is not just a shell swap; update, tray, autostart, login, and server
  lifecycle are user-visible behaviors. Mitigation: parity checklist plus packaged smoke tests.
- high: Native module and bundle layout assumptions currently live in the Electron staging
  path. Mitigation: keep Next/static bundle untouched until the Rust server replaces Node.
- medium: Cookie-login flows rely on Electron session partitions. Mitigation: prototype each
  web-cookie provider before declaring Tauri viable.
- medium: Signing/notarization and artifact publishing can regress outside local tests.
  Mitigation: add CI release dry runs and artifact manifest checks.

blockers:

- Rust backend packaging shape: embedded server binary, sidecar, or external service.
- Decision on whether to preserve `window.electronAPI` shape for the React app.
- Signing/updater credential handling for Tauri release pipelines.

depends_on:

- `frontend-dashboard`
- `http-api-authz`
- `streaming-core`
- `database`
- `cli-bootstrap-services`
- `testing-quality-cicd`

effort_person_weeks:

- Tauri shell with existing dashboard and equivalent local server launch: 8-14 person-weeks.
- Full release parity including updater, login windows, signing, and cross-platform smoke:
  14-24 person-weeks.

notes:

- Blunt recommendation: keep Electron until the Rust backend is usable locally. Tauri is a
  good Rust target, but only after server packaging and frontend serving are no longer moving.

## cli-bootstrap-services

current_stack:

- Published CLI entry is `bin/omniroute.mjs`; `--mcp` bypasses Commander to start the MCP
  stdio path (`package.json:6`, `bin/omniroute.mjs:6`, `bin/omniroute.mjs:35`,
  `bin/omniroute.mjs:192`).
- Commander is the CLI framework, Ink is present for TUI-style surfaces, and command
  registration spans many command modules (`package.json:204`, `package.json:215`,
  `bin/cli/program.mjs:1`, `bin/cli/program.mjs:38`,
  `bin/cli/commands/registry.mjs:61`).
- `serve` is the default command and spawns Node/Next standalone server variants with
  environment-derived ports and memory settings (`bin/cli/commands/serve.mjs:28`,
  `bin/cli/commands/serve.mjs:49`, `bin/cli/commands/serve.mjs:129`,
  `bin/cli/commands/serve.mjs:169`, `bin/cli/commands/serve.mjs:183`).
- CLI/storage bootstrap reads `.env` from `DATA_DIR`, app data, home, cwd, and repo paths,
  and conditionally generates/persists `STORAGE_ENCRYPTION_KEY`
  (`bin/omniroute.mjs:43`, `bin/omniroute.mjs:93`, `bin/omniroute.mjs:107`,
  `bin/omniroute.mjs:134`, `bin/omniroute.mjs:151`).
- CLI runtime detection/configuration is security-sensitive: it validates command paths,
  avoids shell interpolation for direct executables, supports macOS login-shell PATH recovery,
  and passes minimal env to probes (`src/shared/services/cliRuntime.ts:292`,
  `src/shared/services/cliRuntime.ts:304`, `src/shared/services/cliRuntime.ts:308`,
  `src/shared/services/cliRuntime.ts:367`, `src/shared/services/cliRuntime.ts:885`,
  `src/shared/services/loginShellPath.ts:56`, `src/shared/services/loginShellPath.ts:68`).
- Embedded services use `ServiceSupervisor`, safe npm `execFile`, and local-only route
  classification for spawn-capable APIs (`src/lib/services/ServiceSupervisor.ts:64`,
  `src/lib/services/ServiceSupervisor.ts:66`,
  `src/lib/services/installers/utils.ts:76`,
  `src/lib/services/installers/utils.ts:86`,
  `src/server/authz/routeGuard.ts:28`, `src/server/authz/routeGuard.ts:31`,
  `src/server/authz/routeGuard.ts:74`).

rust_targets:

- `clap` plus `clap_complete`: Rust CLI argument parsing and completions.
- `tokio::process::Command`: supervised local server/service process launch with explicit
  env and no shell interpolation.
- `config`, `figment`, or `serde` plus `toml`/`serde_json`: config/env parsing and external
  tool config writers.
- `directories`/`dirs-next`: platform-correct data/config paths.
- `tracing`: CLI and service lifecycle logs.
- `keyring` or explicit file-encryption wrapper: decide whether to preserve current
  `.env`/SQLite encryption-key semantics or move secrets into OS storage.

complexity: high.

key_tasks:

- Split CLI migration into layers: entrypoint/serve/MCP first, then command parity, then
  TUI/config writers, then embedded service installers.
- Define a Rust `ProcessRunner` with the same guardrails: absolute path validation, shell
  avoidance, minimal env, timeout, stdout/stderr truncation, and Windows `.cmd` behavior.
- Preserve `--mcp` stdio semantics before moving any MCP implementation.
- Preserve `DATA_DIR`, `.env`, storage-key bootstrap, port envs, and `OMNIROUTE_*` behavior.
- Inventory all generated API commands and decide whether they remain generated JS wrappers
  until the Rust API stabilizes.
- Port local-only classification tests for spawn-capable routes/services.
- Preserve install/update flows for 9router/cliproxy or intentionally de-scope npm-based
  installers from the Rust CLI.

risks:

- high: Process spawning can regress security if Rust ports bypass existing path/env/shell
  protections. Mitigation: central runner crate plus tests copied from CLI runtime/security
  suites.
- high: CLI config writers touch user home/tool config files. Mitigation: keep dry-run,
  backup, write-guard, and path validation behavior before cutover.
- high: `--mcp` stdio cannot leak logs on stdout. Mitigation: lock stdout/stderr contract
  tests before porting.
- medium: npm-based embedded service install/update does not map cleanly to pure Rust.
  Mitigation: keep npm as an external tool through a guarded process runner until service
  packaging changes.

blockers:

- Decision on whether the Rust CLI ships before, with, or after the Rust server.
- Complete external CLI/tool config inventory and golden samples.
- Secret/key storage decision: preserve `.env` bootstrap or introduce OS keyring.
- Cross-platform runner semantics for Windows `.cmd`, macOS login-shell PATH, and Linux
  service paths.

depends_on:

- `mcp-server`
- `http-api-authz`
- `database`
- `security-stealth`
- `validation-shared`
- `testing-quality-cicd`

effort_person_weeks:

- Core Rust CLI (`serve`, `--mcp`, config/env, process runner): 10-18 person-weeks.
- Full parity across commands, generated API subcommands, TUI, runtime detection, and
  embedded-service lifecycle: 18-30 person-weeks.

notes:

- This subsystem is a good Rust target, but only with tests around process boundaries first.
  The value is operational reliability and distribution, not removing JS command modules all
  at once.

## testing-quality-cicd

current_stack:

- Local scripts mix Node native test runner, Vitest, Playwright, c8 coverage, ESLint,
  TypeScript checks, docs/i18n checks, and bespoke quality scripts (`package.json:80`,
  `package.json:90`, `package.json:165`, `package.json:167`, `package.json:168`,
  `package.json:172`, `package.json:178`).
- Coverage gate is c8 with 60 percent statements/lines/functions/branches
  (`package.json:172`).
- CI runs lint/policy gates, build/package, Electron packaged smoke, 8-way unit shards,
  Vitest MCP/UI, Node 24/26 compatibility, 8-way coverage shards, 9-way Playwright E2E,
  integration shards, security tests, SonarQube, and PR reporting
  (`.github/workflows/ci.yml:24`, `.github/workflows/ci.yml:68`,
  `.github/workflows/ci.yml:389`, `.github/workflows/ci.yml:437`,
  `.github/workflows/ci.yml:466`, `.github/workflows/ci.yml:488`,
  `.github/workflows/ci.yml:513`, `.github/workflows/ci.yml:537`,
  `.github/workflows/ci.yml:561`, `.github/workflows/ci.yml:793`,
  `.github/workflows/ci.yml:837`, `.github/workflows/ci.yml:862`).
- Quality ratchet reads `config/quality/quality-baseline.json`; metrics include ESLint
  warnings, global coverage, per-critical-module coverage, type coverage, CodeQL, secret,
  workflow, vulnerability, and scanner/bundle baselines
  (`config/quality/quality-baseline.json:4`, `config/quality/quality-baseline.json:13`,
  `config/quality/quality-baseline.json:58`,
  `config/quality/quality-baseline.json:102`,
  `config/quality/quality-baseline.json:108`,
  `config/quality/quality-baseline.json:118`).
- Build/package gates depend on Next standalone output and staged `dist/` artifacts
  (`package.json:75`, `package.json:77`, `package.json:78`,
  `scripts/build/assembleStandalone.mjs:4`, `scripts/build/prepublish.ts:119`,
  `scripts/build/prepublish.ts:146`,
  `.github/workflows/ci.yml:431`, `.github/workflows/ci.yml:435`).
- Release workflows publish npm packages, Docker images, and Electron artifacts
  (`.github/workflows/npm-publish.yml:143`, `.github/workflows/npm-publish.yml:179`,
  `.github/workflows/docker-publish.yml:123`,
  `.github/workflows/docker-publish.yml:227`,
  `.github/workflows/electron-release.yml:58`,
  `.github/workflows/electron-release.yml:148`).

rust_targets:

- `cargo test` and `cargo nextest`: Rust unit/integration test execution.
- `cargo llvm-cov` or `grcov`: Rust coverage with thresholds mapped to current c8 gates.
- `rustfmt`, `clippy`, `cargo deny`, `cargo audit`, `cargo machete`: Rust formatting,
  linting, dependency/license/security/dead-code checks.
- `insta`, `proptest`, `wiremock`/`httpmock`: snapshot, property, and HTTP contract tests.
- Keep Playwright for retained React dashboard and desktop smoke tests.
- Keep Node gates for retained JS/TS packages until those packages are de-scoped or deleted.

complexity: very_high.

key_tasks:

- Create a dual-stack CI matrix instead of replacing Node gates immediately.
- Map every current gate to one of: keep JS gate, port to Rust, replace with Cargo tool,
  or retire with explicit justification.
- Introduce Rust coverage thresholds as additive gates first; ratchet only after stable
  baseline data exists.
- Keep Playwright and UI i18n gates unchanged while the React dashboard remains.
- Add contract/golden tests around API behavior before Rust route cutovers.
- Update packaging gates for Rust binary artifacts, Docker images, npm package sidecars,
  and desktop bundles.
- Preserve PR evidence/test policy for production-code changes in both JS and Rust paths.

risks:

- very_high: Dropping bespoke JS gates too early would hide regressions that Cargo tooling
  does not know about. Mitigation: dual-run until each gate has an explicit Rust equivalent.
- high: Coverage percentages are not directly comparable between c8 and llvm-cov. Mitigation:
  seed separate Rust baselines and avoid mixing denominators.
- high: CI time can explode with Node plus Rust plus Playwright plus desktop builds.
  Mitigation: shard Rust tests with nextest, cache Cargo, and gate expensive jobs by path.
- medium: Release artifact validation currently assumes Next standalone `dist/`. Mitigation:
  add Rust artifact manifest checks before changing publish workflows.

blockers:

- Rust workspace/crate layout and binary names.
- Decision on retained JS surfaces: dashboard, CLI command wrappers, Electron/Tauri timing.
- Baseline data for Rust coverage, clippy warnings, dependency audit, and binary size.
- CI runner cache strategy for Cargo, Node, Playwright, Electron/Tauri, and Docker layers.

depends_on:

- all subsystem packets, especially `http-api-authz`, `streaming-core`, `database`,
  `frontend-dashboard`, `electron-desktop`, and `cli-bootstrap-services`.

effort_person_weeks:

- Dual-stack CI scaffolding and baseline gates: 8-16 person-weeks.
- Full parity with ported regression suites, coverage ratchets, release packaging, and
  desktop smoke: 20-35 person-weeks.

notes:

- Treat quality as a migration substrate, not a cleanup tail. The first Rust crates should
  enter CI under additive gates while JS gates remain authoritative for retained surfaces.

## Combined Risk Summary

| Risk                                                                   | Severity  | Affected subsystems                                            | Mitigation                                                                                                                  |
| ---------------------------------------------------------------------- | --------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Full frontend rewrite overwhelms migration                             | Very high | frontend-dashboard, testing-quality-cicd                       | Keep React/Next and use Rust behind typed API contracts.                                                                    |
| Desktop parity is broader than Tauri window creation                   | High      | electron-desktop, frontend-dashboard, cli-bootstrap-services   | Build a parity matrix and require packaged smoke before cutover.                                                            |
| Process spawning/security regressions                                  | High      | cli-bootstrap-services, electron-desktop                       | Central Rust process runner with no shell interpolation, path validation, timeout, minimal env, and local-only route tests. |
| i18n scale and fallback semantics break UI                             | High      | frontend-dashboard, testing-quality-cicd                       | Preserve 42-locale checks, fallback merge behavior, and UI coverage gates.                                                  |
| Test and coverage gates lose meaning across languages                  | Very high | testing-quality-cicd                                           | Keep dual gates, seed independent Rust baselines, and map each gate explicitly.                                             |
| Build/package layout changes break npm, Docker, desktop, or VPS deploy | High      | testing-quality-cicd, electron-desktop, cli-bootstrap-services | Add artifact manifests and release dry runs before replacing `dist/`/standalone assumptions.                                |

## Verification Evidence

Commands run:

- `Get-Content -Raw AGENTS.md`
- `Get-Content -Raw CLAUDE.md`
- `Get-Content -Raw docs/handoff.md`
- `git rev-parse --show-toplevel; git branch --show-current; git status --short`
- `rg --files "src/app/(dashboard)" "src/shared/components" "src/i18n"`
- PowerShell count of dashboard pages/files, shared components, i18n files, CLI locale files,
  Electron files, CLI files, service files, workflows, check scripts, quality scripts, and
  test files.
- `rg -n` over `package.json`, `next.config.mjs`, `src/i18n/*`, dashboard layout/sidebar,
  Electron package/main/preload, CLI entry/program/serve/runtime, service supervisor,
  route guard, CI workflows, quality baseline, Playwright/Vitest configs, and build scripts.

No tests were run because this packet creates a planning/analysis Markdown file only and
does not change production code.
