# Packet P4: Security, Validation, Shared Constants

## Objective

Produce a source-grounded migration assessment for these handoff subsystems and
cross-cutting concerns:

- `security-stealth`
- `validation-shared`
- docs accuracy and risk-register checks across all migration docs

## Context

Source handoff: `D:\dev\OmniRoute\docs\handoff.md`.

## Ownership

Read-only source analysis plus one result file in the packet worktree:
`.workflow/rust-migration-roadmap/results/P4-security-validation-shared.md`.

## Do

- Inspect actual files before making claims.
- Cite source paths and lines for key behavior.
- Include current stack, Rust targets, complexity, key tasks, risks, blockers,
  dependencies, effort range, and notes.
- Pay special attention to error sanitization, public credential helpers, upstream
  header denylist, child-process safety rules, route guard classifications,
  TLS/JA3/stealth parity, Zod schemas, provider constants, routing strategy constants,
  and docs fabricated-claim guardrails.

## Do Not

- Do not edit production code.
- Do not edit docs outside the packet result file.
- Do not modify `D:\dev\OmniRoute`.
- Do not commit, push, or open PRs.

## Expected Output

One markdown result file with a concise assessment per subsystem and a combined
cross-cutting risk checklist for integration.

## Verification

Run narrow grep/count commands for any exact names or counts used in the result.
