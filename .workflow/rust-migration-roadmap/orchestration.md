# Orchestration: Rust migration roadmap

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.
- Use feature branches and isolated worktrees for each worker.
- Workers are not alone in the codebase; they must not revert other edits.
- Workers may only write their packet result file.
- Operational artifacts are English; user-facing updates are Japanese.

## Branching Rules

- Integration branch/worktree:
  - Branch: `feature/rust-migration-roadmap-orchestration`
  - Path: `C:\Users\geekjapan\.codex\worktrees\8f13\OmniRoute-rust-roadmap`
- Worker branches/worktrees, all based on `origin/main`:
  - `feature/rust-roadmap-api-streaming`
  - `feature/rust-roadmap-data-protocols`
  - `feature/rust-roadmap-ui-desktop-quality`
  - `feature/rust-roadmap-security-validation`
- Do not touch the shared checkout `D:\dev\OmniRoute` except to read the source
  handoff file.
- Do not commit, push, or open PRs without explicit approval.

## Packet Prompts

See `packets/P1-api-streaming-routing.md` through
`packets/P4-security-validation-shared.md`.

Each worker prompt must include:

- Worktree path and branch name.
- Packet file content.
- Requirement to create only
  `.workflow/rust-migration-roadmap/results/<packet>.md`.
- Requirement to verify exact names/counts with grep/count commands.
- Reminder not to modify shared checkout, commit, push, or open PRs.

## Completion Audit

1. Confirm all worker result files exist and are readable.
2. Integrate high-confidence findings into:
   - `docs/migration/RUST_MIGRATION_ROADMAP.md`
   - `docs/migration/RUST_MIGRATION_TODO.md`
3. Run workflow artifact verification.
4. Run docs checks or document exact blockers.
5. Update `state.json` and `final-report.md`.
