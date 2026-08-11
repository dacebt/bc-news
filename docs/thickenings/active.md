---
type: thickening
title: >-
  Thickening: commit-addressed evaluation history
description: >-
  Active WSD thickening for reopening scorecards from their recorded Git state while reporting, never enforcing, checkout freshness.
tags: [wsd, thickening, active]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-11T02:09:41Z"
---
# Thickening: commit-addressed evaluation history

**Started:** 2026-08-10
**Git strategy:** commit the coherent replacement directly to local `main`; no push
**Cadence:** Normal

## Dimension

Repository-owned evaluation evidence identity and freshness reporting.

## Observable delta

- before: opening a scorecard reconstructs copied Base64 source files, and opening a longitudinal artifact reconstructs copied scorecard files, so ordinary evaluator metadata changes cascade into a giant regenerated artifact.
- after: an evaluator opens the same scorecard and longitudinal reports from commit-and-path references, sees whether the recorded code state is current or outdated relative to the checkout, and can still run a new evaluation from a newer commit without any freshness failure.

## Minimum surface

- Current versioned scorecard and longitudinal declaration/artifact contracts with one contained repository-relative reference shape and no embedded source payload fields or recursive whole-file hashes.
- A current version-2 corpus manifest/reference contract that links committed evidence by canonical paths and semantic fixture IDs without cross-file byte hashes while preserving strict source-grounding checks.
- Git-backed source resolution using an explicitly supplied repository root, so result directories may live outside Git; it reads the exact recorded evidence commit, never substitutes working-tree bytes, and reports each evaluated code commit as current/outdated without rejecting a valid historical evaluation.
- Scorecard and longitudinal builders, stores, reports, CLI paths, Codex evaluator provenance, and current input loading threaded through the reference contract while historical artifact meanings remain explicit.
- Focused semantic tests and direct verifiers that exercise exact commit resolution, missing references, path containment, outdated reporting, unchanged-context comparison, and absence of copied bytes.
- Removal of the 29 MB controlled longitudinal artifact after the replacement verification path no longer consumes it, plus binding architecture/testing/model documentation and the reopened ADR/task outcome.

## Verification path

`pnpm --filter @bc-news/eval verify:evaluation-reference-corpus`, `pnpm --filter @bc-news/eval verify:evaluation-scorecards`, and `pnpm --filter @bc-news/eval verify:evaluation-longitudinal-scorecards` create compact committed evidence, place results outside that Git checkout, reopen historical artifacts through recorded evidence commits, compare the evaluated code commits with HEAD, print `outdated` without failing, prove four role reports and longitudinal classifications, and end with their exact verified markers. Eval typecheck, the full eval test suite, workspace lint, `git diff --check`, and the probe-backed composed walk ending in `WALK PASS` prove the replacement did not regress the larger product.

## Residual risks

- Non-invariant: local Git history can be garbage-collected only after commits become unreachable; external archival or repository replication policy is outside this local evaluator change.
- Non-invariant: existing version-1 byte-owning artifacts remain historical contracts if encountered, but the removed synthetic golden file is no longer maintained or exercised as current evidence.
- Non-invariant: a useful UI for filtering outdated evaluations can be added later; this thickening provides truthful report text and structured freshness data.

## Notes

Commit difference is not a failure condition. `outdated` means only that the checkout has advanced beyond the code state named by the evaluation. Existing hashes that identify domain content inside Benchmark Runs, requests, schemas, or metric context remain; the removed design is whole-file copying and recursive parent/child hash ownership.

## Context

- governed by the [commit-addressed evaluation evidence shape](../direction/2026-08-10-commit-addressed-evaluation-evidence.shape.md)
- repairs capability 4 of the [longitudinal scorecard map](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.map.md)
- updates vocabulary in the [evaluation and verification model](../direction/bc-news.model.md)
