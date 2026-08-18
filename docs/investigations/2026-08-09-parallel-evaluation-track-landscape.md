---
type: investigation
title: >-
  Investigation: parallel evaluation-track landscape
description: >-
  Multi-pass trace of pre-BCN-005 trial scheduling, retained-artifact ownership, concurrency constraints, proof surfaces, and documentation boundaries.
tags: [investigation, evaluation, concurrency, retained-evidence, bcn-005]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:53:45Z"
---
# Investigation Report

**Question:** What currently makes main-story and announcements evaluation
tracks serial, what owns and validates retained state under interleaving, what
evidence surfaces prove the behavior, and which documentation owns a scheduling
change?

**Date:** 2026-08-09

**Snapshot:** Repository `main` at `ad54026`; isolated BCN-005 worktree at
`8af8233`. Code and binding-document line references below describe that
point-in-time `main`, not the older worktree base.

**Scope:**
- **In scope:** Evaluation-trial and benchmark execution, model-provider
  boundaries, Benchmark Run persistence and transition validation, current v5
  contracts, retained real-model evidence, deterministic eval proofs, browsing,
  relevant history, and documentation authority.
- **Out of scope (deliberately):** Production generation orchestration,
  concurrent benchmark trials or roster members, parallel model loading, live
  inference, implementation design, and revision of the existing draft shape.

---

## Summary

BCN-005 is a within-trial scheduling change. Current benchmark roster members
are intentionally serial, and separately, each trial completes the entire
main-story writer-to-copyeditor chain before it marks announcements running.
Five recent retained v4 benchmark files containing seven real-model trials show
that ordering directly: every announcements writer starts after the final
main-story invocation ends.

The provider boundary does not impose that order. Live providers are resolved
per production step. The hosted adapter holds request state inside one `fetch`,
the LM Studio adapter creates and disposes one client inside each `complete`
call, and the recorded provider reads an immutable response roster. Current v5
live evaluation forbids the recorded adapter. No mutable provider-level request
state was found that serializes the two tracks
(`apps/eval/src/evaluation-trial-support.ts:39-40`,
`apps/eval/src/model-adapters.ts:27-68`,
`packages/model-adapters/src/openai-compatible-model-provider.ts:139-225`,
`packages/model-adapters/src/lmstudio-model-provider.ts:220-304`,
`packages/fixtures/src/recorded-model-provider.ts:26-68`). This is static
application evidence, not a claim that a model runtime will execute two requests
simultaneously.

The concurrency boundary is the trial's retained state. `executeEvaluationTrial`
owns one mutable in-memory Benchmark Run; each update derives a whole next
snapshot from that variable, allocates the next invocation ordinal from its
current invocation array, awaits `store.replace`, and only then advances the
variable (`apps/eval/src/evaluation-trial-execution.ts:30-57`). The store
validates one full snapshot against bytes read from disk, writes a unique
temporary file, and renames it atomically, but it has no queue, lock, revision,
or compare-and-swap across concurrent replacements
(`apps/eval/src/evaluation-artifact-store.ts:51-105`).

A controlled temporary probe forced two sibling `replace` calls past their
writes together. Both replacements fulfilled after validating against the same
running version 4 artifact, but the final authoritative file retained only the
announcements transition and returned main-story to pending. The probe used the
same version-dispatched store and transition code used by v5, made no provider
call, changed no repository file, and removed its temporary directory. It
directly confirms that atomic rename prevents partial bytes but does not prevent
a valid sibling update from being overwritten.

Current v5 schemas do not require the tracks themselves to be serial. They
require invocation ids to be unique, ordinals contiguous, starts nondecreasing
in ordinal order, retries linked to the immediately previous same-step failure,
and each selected writer to precede its selected copyeditor
(`apps/eval/src/evaluation-artifact-v5-trial-refinement.ts:17-43`,
`apps/eval/src/evaluation-artifact-v5-trial-refinement.ts:84-117`). Both tracks
must be terminal before trial completion, no invocation may remain pending, and
the aggregate outcome must match both track outcomes
(`apps/eval/src/evaluation-artifact-v5-trial-refinement.ts:120-142`). The shared
transition validator permits each track to advance independently while allowing
only one invocation append per retained transition
(`apps/eval/src/evaluation-artifact-transition.ts:62-95`). The schema therefore
represents truthful interleaving already; no observed contract rule alone
establishes a need for artifact version 6.

**Follow-up (verified 2026-08-18):** `fe1b575`, `eefe6ec`, and merge `0cc33d6`
landed BCN-005. Current trial execution runs both tracks concurrently, waits for
both to settle, and serializes retained-state mutations through one queue. The
v4 benchmark files and v5 source paths cited below are unavailable in the
current checkout; the report remains the pre-change landscape, not current
scheduling guidance.

## Execution and Failure Trace

`benchmark run` calls `evaluateBenchmarkCommand`, which appends and awaits one
roster trial at a time (`apps/eval/src/cli.ts:90-98`,
`apps/eval/src/evaluation-benchmark-command.ts:88-121`). That is one serial
layer and remains outside BCN-005.

Inside the trial runner, main-story is marked running, written, optionally
copyedited, and terminated before announcements is marked running and follows
the same chain (`apps/eval/src/evaluation-trial-execution.ts:103-134`). This is
the second serial layer and is the task boundary. Writer-to-copyeditor dependency
is track-local in both the execution and v5 validation.

All provider exceptions are retained as failed transport, classified, and
either retried or returned as an infrastructure-incomplete track result
(`apps/eval/src/evaluation-trial-execution.ts:58-75`). Expected parse-contract
failures are retained and terminate only their own track. An unexpected parser
exception or any store failure escapes the trial runner; the command has no
recovery wrapper and the CLI reports failure (`apps/eval/src/evaluation-trial-execution.ts:82-95`,
`apps/eval/src/evaluation-trial-command.ts:56-74`,
`apps/eval/src/cli.ts:175-189`). The provider port accepts no caller-owned
abort signal (`packages/generation-core/src/ports.ts:39-58`). Hosted and LM
Studio adapters own only their individual timeouts. The repository therefore
has no current cross-track cancellation or quiescence contract for an unexpected
harness failure because no concurrent track dispatcher exists yet.

This distinction is load-bearing: subject rejection and provider exhaustion
must not suppress a sibling track, while invalid state or persistence is a
harness failure that stops trustworthy coordination. The binding architecture
states both sides explicitly (`docs/ARCHITECTURE.md:273-287`).

## Observed and Deterministic Evidence

Five retained real-model Benchmark Runs from 2026-08-09 contain seven completed
trials. They are version 4 historical artifacts. Across completed,
infrastructure-incomplete, preservation-rejected, and final-product-rejected
outcomes, every first announcements invocation starts 47–115 milliseconds after
the final main-story invocation ends. These artifacts prove the current serial
execution inherited by the live harness, but they do not demonstrate current v5
subject semantics.

On current `main`, eval typecheck plus the trial-retention, serial-continuation,
and browse verifiers passed. A final focused package run passed all 18 eval test
files and 110 tests. Existing proofs establish disk-authoritative observer
ordering, in-flight-before-transport retention, completion-before-parse
retention, retry classification, non-suppression after rejection or exhaustion,
serial roster continuation, strict reading, and behavioral comparison
(`apps/eval/src/evaluation-trial-verifier.ts:57-89`,
`apps/eval/src/evaluation-trial-verifier.ts:196-220`,
`apps/eval/src/evaluation-benchmark-verifier.ts:51-80`,
`apps/eval/src/evaluation-browse-verifier.ts:178-211`).

No current test or verifier observes both track writers in flight at once,
concurrent calls to `EvaluationArtifactStore.replace`, or strict browsing of a
running interruption artifact. Store tests replay snapshots sequentially and
exercise monotonic rejection and atomic-file failure, not sibling writers
(`apps/eval/tests/evaluation-artifact-store.test.ts:8-163`). The browse verifier
creates terminal artifacts before exercising list, show, summary, and compare
(`apps/eval/src/evaluation-browse-verifier.ts:130-197`).

The reader itself accepts any strict version-dispatched Benchmark Run, including
a schema-valid running artifact (`apps/eval/src/evaluation-artifact-reader.ts:40-111`).
`benchmark show` emits the full artifact. `benchmark summary` retains track
lifecycle, invocation order, transport state, duration, and retry relationships,
but intentionally omits absolute invocation timestamps
(`apps/eval/src/evaluation-browse-report.ts:23-37`,
`apps/eval/src/evaluation-browse-report.ts:71-113`). Thus current browsing code
can expose an interruption state, while existing proof does not yet establish
that contract or make overlap visible through the summary alone.

## Historical Meaning of “Independent”

The main-then-announcements sequence entered with `0f0f040`, which introduced
incremental retention of rejected model trials. The architecture statement that
the tracks “execute independently” entered with `fdb7d52`, whose behavior was
continuing serial benchmarks after rejection. Current blame still attributes
the scheduling statements to those commits. In repository history,
“independent” therefore means failure non-suppression, not concurrent dispatch.

## Documentation Impact Boundary

The documentation router makes architecture and testing binding and requires
them to change in the same unit when behavior changes (`CLAUDE.md:10-28`). The
observed scheduling contract is distributed as follows:

- `docs/ARCHITECTURE.md` owns incremental request/invocation retention,
  atomic replacement, interruption behavior, serial roster coordination,
  independent track outcomes, and harness failure (`docs/ARCHITECTURE.md:238-314`).
  It is a required documentation surface for any changed track schedule and
  retained-mutation ownership.
- `docs/TESTING.md` owns what model evaluation and its direct proofs establish,
  including serial roster behavior, non-suppression, incremental retention, and
  the exact verifier observations (`docs/TESTING.md:40-72`,
  `docs/TESTING.md:120-155`, `docs/TESTING.md:223-257`). It is required if a new
  proof makes concurrent dispatch or interruption browsing observable.
- `README.md` is the operator surface for `benchmark run`, current artifact
  semantics, repository-owned proof commands, and the phrase “declared serial
  live benchmark” (`README.md:72-106`, `README.md:164-197`). It must continue to
  distinguish serial roster execution from any within-trial track scheduling.
- `docs/DOMAIN.md` and `docs/direction/bc-news.model.md` already define one trial
  across independent main-story and announcements tracks without assigning a
  schedule (`docs/DOMAIN.md:65-80`, `docs/direction/bc-news.model.md:20-53`). No
  current vocabulary contradiction was found.
- `docs/PRD.md` and ADR-015 describe the production generation Workflow, whose
  four calls remain serial (`docs/PRD.md:47-60`, vault
  `docs/decisions/ADR-015-two-products-four-production-steps.md:43-65`). BCN-005
  does not authorize changing that production contract.
- The isolated shape, active-thickening draft, and their index entries are
  unapproved working documents on a branch five commits behind current `main`.
  They describe artifact v4-era state and cannot govern current v5 work without
  later reconciliation. This investigation does not revise them.

## Verified Boundary

The landscape supports a narrow scope: trial-local scheduling and its single
retained-state ownership boundary, deterministic evidence for concurrent
progress and interruption, and the three load-bearing repo documents above.
No evidence found a requirement to change provider adapters, production
generation, benchmark roster scheduling, model loading, domain vocabulary,
comparison semantics, historical artifact meanings, or current v5 subject
outcomes. Those are verified exclusions from the observed problem, not an
implementation plan.

---
_Indexed from [project investigations](./index.md) and the [documentation bundle](../index.md)._
