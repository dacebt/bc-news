---
type: shape
title: >-
  Shape: parallel evaluation tracks
description: >-
  Session boundaries, cadence, and success signal for concurrent within-trial evaluation tracks with one truthful retained-state history.
tags: [wsd, direction, shape, evaluation, concurrency]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-09T18:16:15Z"
---
# Shape: parallel evaluation tracks

**Declared:** 2026-08-09
**Cadence:** Loose
**Git strategy:** worktree-isolated — commit coherent units directly to `bcn-005-parallel-evaluation-tracks` in `.worktrees/bcn-005-parallel-evaluation-tracks`; landing on `main` remains a separate reviewed action

## In scope

- Run the main-story and announcements writer-to-copyeditor chains concurrently within one evaluation trial while benchmark roster members remain serial.
- Give invocation allocation and every retained Benchmark Run transition one ordered owner so interleaved track progress cannot duplicate ordinals, lose sibling updates, or weaken incremental durability.
- Preserve current artifact version 5 subject outcomes, diagnostics, retry linkage, writer-to-copyeditor dependency, terminal aggregation, and historical version meanings.
- Establish deterministic runtime evidence for simultaneous writer dispatch, truthful interleaving, independent rejection or provider exhaustion, interruption browsing, and normal completion.
- Amend `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and `README.md` to distinguish serial roster execution from concurrent within-trial tracks and describe the observed proof.

## Out of scope (deliberately)

- Concurrent benchmark trials or roster members, parallel model loading, or model-runtime parallelism guarantees.
- Production generation Workflow scheduling, fixture authoring, context benchmarking, recorded-replay acceptance, or provider-adapter redesign.
- A new Benchmark Run artifact version, changed v5 subject outcomes or diagnostics, historical artifact rewrites, prompt changes, or sampling-policy changes.
- Live local or hosted inference, model lifecycle operations, deployment, push, or landing the branch on `main`.

## Known risks

- The reproduced store race allows two valid sibling replacements to succeed while the final rename loses one track's state.
- Unexpected parser or persistence failure can escape while a sibling provider call is active; the provider port has no caller-owned cross-track cancellation contract.
- The isolated branch predates current artifact v5 work on `main`; build mode cannot begin against its stale v4 base.

## Success signal

A repository-owned controlled evaluation retains both writer invocations as in flight before either provider is released, preserves each writer-to-copyeditor dependency through interleaved progress, retains an independently rejected or exhausted track without suppressing its sibling, and strictly browses both the interruption-state v5 artifact and the normally completed Benchmark Run.

## Notes

The investigation fixes the boundary at harness dispatch plus one ordered retained-state history; it does not claim the underlying model runtime executes requests simultaneously. Before build mode, the branch must be reconciled with current `main`, its completed same-date schema-only shape deprecated so this remains the sole active declaration, and a fresh thickening selected after the promised user conversation. The premature active-thickening draft remains unapproved and outside this shape commit.

## Related documentation

- [Parallel evaluation-track investigation](../investigations/2026-08-09-parallel-evaluation-track-landscape.md) — supplies the verified execution, persistence, schema, proof-surface, history, and documentation boundaries.
- [Evaluation and verification model](bc-news.model.md) — supplies the established Benchmark Run, trial, track, invocation, subject-outcome, and harness-outcome vocabulary.
- [Binding testing posture](../TESTING.md) — owns evaluation evidence and outcome semantics.
- [Binding architecture](../ARCHITECTURE.md) — owns incremental retention, transition, and track-independence contracts.
