# Rust migration roadmap

## Goal

Create the Rust migration planning deliverables requested by
`docs/handoff.md`:

- `docs/migration/RUST_MIGRATION_ROADMAP.md`
- `docs/migration/RUST_MIGRATION_TODO.md`

The deliverables are planning docs only. No production code migration is in scope.

## Success Criteria

- The roadmap gives a blunt feasibility verdict, recommends a migration strategy, and
  resolves the frontend/backend/desktop scope question.
- The roadmap covers all 14 handoff subsystems with source-grounded notes.
- The TODO is a granular phase-by-phase checklist aligned with the roadmap.
- All generated docs avoid fabricated APIs, routes, env vars, commands, and counts.
- Work is performed from feature branches and isolated git worktrees.
- A narrow docs verification pass completes before reporting.

## Current Context

- Source handoff: `docs/handoff.md` (untracked in the shared main
  checkout; do not edit that checkout).
- Integration worktree:
  `<integration-worktree>`
- Integration branch: `feature/rust-migration-roadmap-orchestration`
- Base: `origin/main` at `e2bee77e767c3d878dc82a847c1d0fca3ce29604`
- Prior failed run launched 16 agents at once and hit a transient service rate limit.

## Constraints

- User-facing coordination and final report are Japanese.
- Operational artifacts and docs are English to match the repository's docs style.
- Do not modify `<shared-checkout>` because it contains unrelated local changes.
- Do not commit secrets or machine-local auth/cache material.
- Do not commit directly to `main`.
- For markdown claims, grep or count before documenting precise names/counts.
- Prefer source citations (`path:line`) over unsupported prose.

## Risks

- Broad repo analysis can produce plausible but unverified specifics.
- Parallel agents can collide or trip rate limits if too many are launched.
- Rust crate recommendations can become speculative if not tied to subsystem needs.
- Existing docs counts may drift; verify live before using exact numbers.

## Approval Required

- No destructive, external, deployment, credential, or production-data action is planned.
- User already requested parallel subagents. Concurrency is limited to 4 workers.
- Additional approval is required before commits, pushes, PR creation, deletes, force
  operations, migrations, deploys, or external writes.

## Work Packets

- `P1-api-streaming-routing`: HTTP/API/authz, streaming core, executors/translators,
  routing/resilience/compression.
- `P2-data-protocols-domain`: database, MCP server, A2A/ACP/cloud agent, domain extras.
- `P3-ui-desktop-cli-quality`: frontend dashboard, Electron/Tauri, CLI/bootstrap/services,
  testing/quality/CI/CD.
- `P4-security-validation-shared`: security/stealth, validation/shared constants, docs
  accuracy checks, cross-cutting risk register.
- `P5-integration`: main-agent synthesis into final docs, critique absorption, verification.

## Integration Policy

- Workers write packet result files in their own worktrees only.
- Main agent reads packet results, verifies high-risk claims against source, and writes the
  final docs in the integration worktree.
- If packet conclusions conflict, the authoritative source wins.
- Do not merge worker branches unless explicitly asked; use their result files as inputs.

## Verification

- Run workflow artifact completeness check:
  `python <codex-dynamic-workflows>/scripts/verify_workflow.py .workflow\rust-migration-roadmap`
- Run docs-focused checks when feasible:
  - `npm run check:docs-counts`
  - `npm run check:fabricated-docs -- --strict`
- If broad docs checks fail on pre-existing docs outside touched files, record the exact
  failure and perform targeted verification for the new docs.

## Reusable Artifacts

- `.workflow/rust-migration-roadmap/plan.md`
- `.workflow/rust-migration-roadmap/orchestration.md`
- `.workflow/rust-migration-roadmap/packets/*.md`
- `.workflow/rust-migration-roadmap/results/*.md`
- `.workflow/rust-migration-roadmap/final-report.md`
