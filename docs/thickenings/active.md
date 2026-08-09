---
type: thickening
title: >-
  Thickening: concurrent evaluation-track execution
description: >-
  Active WSD thickening for both editorial evaluation tracks to advance concurrently through one truthful retained Benchmark Run history.
tags: [wsd, thickening, active, evaluation, concurrency]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-09T18:37:13Z"
---
# Thickening: concurrent evaluation-track execution

**Started:** 2026-08-09
**Git strategy:** worktree-isolated — commit coherent units directly to `bcn-005-parallel-evaluation-tracks`
**Cadence:** Loose

## Dimension

Within-trial evaluation concurrency and retained-evidence coordination at the
Benchmark Run application boundary.

## Observable delta

- before: one evaluation trial completes the full main-story chain before
  announcements starts, and concurrent full-snapshot replacements can lose a
  valid sibling transition.
- after: both writer-to-copyeditor chains advance concurrently while every
  invocation, retry, parse result, selection, track transition, and terminal
  outcome enters one monotonic, incrementally durable version 5 history.

## Minimum surface

- Evaluation-trial orchestration for two track-local dependency chains,
  independent expected-failure containment, and terminal aggregation.
- One ordered application-layer owner for invocation allocation and retained
  Benchmark Run mutation, preserving the artifact store's disk-authoritative
  validation and atomic replacement boundary.
- Controlled evaluation runtime evidence for simultaneous writer dispatch,
  interleaved copyedit progress, isolated rejection or exhaustion, interruption
  browsing, normal completion, and unchanged serial roster continuation.
- Binding architecture and testing contracts plus the operator README wording
  that distinguishes serial roster execution from concurrent within-trial tracks.

## Verification path

- `pnpm --filter @bc-news/eval verify:evaluation-trial-retention` observes both
  writer invocations durably retained as `in_flight` before either provider is
  released, then observes interleaved track-local progress, isolated failure,
  a strict running interruption artifact, and terminal completion.
- `pnpm --filter @bc-news/eval verify:evaluation-benchmark-continuation` observes
  that configuration and repetition roster members remain serial and continue
  after a prior trial's terminal model or infrastructure outcome.
- `pnpm --filter @bc-news/eval verify:evaluation-browse`, eval tests, typecheck,
  and lint validate strict v1-v5 reading, retained evidence, transition rules,
  and documentation-aligned command behavior.
- The canonical probe-backed `pnpm walk -- --non-interactive` ends in
  `WALK PASS`, demonstrating that the composed recorded-provider product still
  completes its four-step production workflow; it does not claim live-model
  runtime parallelism.

## Residual risks

- Non-invariant: an underlying model provider or runtime may serialize requests
  after the harness has dispatched both tracks concurrently.
- Non-invariant: the exact cross-track invocation order can vary with provider
  timing; each retained order must remain truthful and valid rather than
  byte-identical across runs.

## Notes

Current artifact version 5 and historical version meanings remain unchanged.
No live inference, provider redesign, production Workflow scheduling change, or
concurrent benchmark roster execution belongs to this thickening.

## Context

- [Current shape](../direction/2026-08-09-parallel-evaluation-tracks.shape.md) — governs scope, Loose cadence, isolated commits, and the success signal.
- [Landscape investigation](../investigations/2026-08-09-parallel-evaluation-track-landscape.md) — supplies the verified execution, persistence, schema, proof, history, and documentation boundaries.
- [Evaluation domain model](../direction/bc-news.model.md) — supplies established Benchmark Run, Evaluation Trial, track, invocation, subject-outcome, and harness-outcome vocabulary.
- [Binding testing posture](../TESTING.md) — owns the evidence domains and model-evaluation proof contract.
