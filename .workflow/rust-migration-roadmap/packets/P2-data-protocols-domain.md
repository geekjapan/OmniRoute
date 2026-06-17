# Packet P2: Data, Protocols, Domain Extras

## Objective

Produce a source-grounded migration assessment for these handoff subsystems:

- `database`
- `mcp-server`
- `agent-protocols`
- `domain-extras`

## Context

Source handoff: `D:\dev\OmniRoute\docs\handoff.md`.

## Ownership

Read-only source analysis plus one result file in the packet worktree:
`.workflow/rust-migration-roadmap/results/P2-data-protocols-domain.md`.

## Do

- Inspect actual files before making claims.
- Cite source paths and lines for key behavior.
- Include current stack, Rust targets, complexity, key tasks, risks, blockers,
  dependencies, effort range, and notes.
- Pay special attention to SQLite/WAL/migrations/encryption, MCP transports/tools/scopes,
  A2A task lifecycle, ACP/cloud-agent boundaries, policy engine, memory, skills, evals,
  and webhooks.

## Do Not

- Do not edit production code.
- Do not edit docs outside the packet result file.
- Do not modify `D:\dev\OmniRoute`.
- Do not commit, push, or open PRs.

## Expected Output

One markdown result file with a concise assessment per subsystem and a combined risk summary.

## Verification

Run narrow grep/count commands for any exact names or counts used in the result.
