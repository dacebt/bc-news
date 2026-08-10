---
type: thickening
title: >-
  Thickening: observable model runtime evidence
description: >-
  Active WSD thickening for browsing a truthful normalized runtime fingerprint on every retained benchmark invocation.
tags: [wsd, thickening, active]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-10T04:20:42Z"
---
# Thickening: observable model runtime evidence

**Started:** 2026-08-10
**Git strategy:** commit this coherent thickening directly to local `main`; no push
**Cadence:** Normal

## Dimension

Model-invocation evidence at the existing provider and strict Benchmark Run boundary.

## Observable delta

- before: an evaluator can inspect the declared model and returned identifier, token usage, application latency, and billing class, but cannot tell which observable runtime state produced an invocation.
- after: an evaluator runs and browses one benchmark whose every invocation has lifecycle-matched normalized runtime evidence; successful invocations capture a comparable execution-context fingerprint plus separate volatile prediction observations, with every unavailable field explicitly unknown or externally controlled.

## Minimum surface

- The existing `ModelCompletion` result and local, hosted, and controlled-provider adapters, with one normalized application-owned runtime-evidence vocabulary rather than raw SDK configuration blobs; published model-usage records remain an explicit legacy-field projection.
- A new current strict Benchmark Run version and its construction, transitions, readers, observation/comparison projection, and summary/detail surfaces while versions 1–6 remain frozen. Its top-level roster is ordered by trial roster then invocation ordinal and identifies trial, invocation, configuration, production step, and ordinal.
- Atomic roster transitions: an appended in-flight invocation appends `pending`; failed transport resolves only to `unavailable`; successful transport resolves only to `captured`; resolved entries are immutable and cannot detach, duplicate, reorder, or change independently of their invocation.
- LM Studio SDK observation at the already-open client/model/result seam, including a verified pinned SDK release constant, LM Studio version/build, distinct selected-model and response-model identities, context, prediction timing/stop statistics, and observable reasoning state. Auxiliary observation failures produce canonical unknown fields and never turn successful inference into transport failure.
- Field-specific normalization for nonblank strings, nonnegative or positive integers, finite nonnegative measurements, speculative count relations, and a closed reason vocabulary so invalid values or prose do not become false evidence or artificial context drift.
- A repository-owned direct verifier and focused unit/contract tests that exercise observed, unknown, and externally controlled states without requiring live inference.
- Binding architecture, testing, README, and WSD vocabulary updates needed to describe the new evidence truthfully.

## Verification path

`pnpm --filter @bc-news/eval verify:benchmark-runtime-evidence` creates and reparses a controlled current-version Benchmark Run through the real application boundary, browses its summary, and ends with `BENCHMARK RUNTIME EVIDENCE VERIFIED` only when all four invocation records are captured, context and prediction projections are separate, representative versions 1–6 still parse, injected runtime evidence in a V6 completion is strictly rejected, and V7 legacy completion objects contain no leaked runtime field. The project-level typecheck, lint, test suite, and `/Users/epicbadtiming/.codex/plugins/cache/ebt-plugins/ebt-wsd/0.12.2/bin/wsd-walk --require-probe --expect "WALK PASS"` then prove the provider/evaluation changes did not regress the composed product.

## Residual risks

- Non-invariant: future SDK releases may expose additional stable observables; the normalized contract can gain them only through a later artifact version.
- Non-invariant: hosted providers may report fewer runtime details than LM Studio and will honestly retain externally controlled or unknown states.
- Non-invariant: runtime fingerprints make later cohorts comparable but do not themselves score quality or establish a baseline.

## Notes

Do not retain deprecated raw `loadConfig` or `predictionConfig` objects. Normalize only reviewed fields. `execution_context` owns client SDK, provider runtime, selected and response model identities, context length, requested/effective reasoning posture, and speculative draft-model identity. `prediction_observation` owns stop reason, timing, throughput, speculative token counts, and reasoning-content presence. Only `execution_context` participates in context comparison. Reasoning evidence describes what was observable in the response and what the application declared; it must not guess an LM Studio UI setting.

## Context

- governed by the [longitudinal scorecard shape](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.shape.md)
- implements capability 1 of the [longitudinal scorecard map](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.map.md)
- uses the established vocabulary in the [evaluation and verification model](../direction/bc-news.model.md)
