---
type: thickening
title: >-
  Thickening: generation-run mechanical retry behavior
description: >-
  Active WSD thickening for recovering one mechanically invalid writer completion without publishing invalid output or repeating accepted work.
tags: [wsd, thickening, active, generation, retries]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-31T19:22:55Z"
---
# Thickening: generation-run mechanical retry behavior

**Started:** 2026-08-31
**Git strategy:** commit-to-main
**Cadence:** Loose

## Dimension

Generation-run retry behavior at the model-output contract boundary.

## Observable delta

- before: the first mechanically invalid completion ends that regional generation run without an edition;
- after: the run rejects that completion, invokes only the failed writer once more with distinct retained attempt evidence, and publishes one valid edition when the retry satisfies the contract without repeating accepted writer work.

## Minimum surface

- Production Workflow sequencing and per-attempt correlation for both writer steps.
- Strict current operator-status attempt evidence, legacy status readers, accepted-product edition provenance, and truthful usage/cost retention.
- Recorded-provider and composed-walk inputs that exercise one rejected completion followed by one accepted completion.
- Focused generation/status/parser tests plus binding architecture, testing, and operational vocabulary alignment.

## Frozen seam

- New runs persist a strict `current_v2` status projection with accepted `model_usage` kept separate from append-only `model_attempts` evidence.
- A model attempt has a stable writer-and-ordinal identity, an independently validated correlation ID, a terminal accepted or mechanically rejected outcome, and the completion's usage/cost evidence. Exact-prefix persistence is idempotent; duplicate or reordered identities are rejected.
- The first attempt keeps each existing durable Workflow step name. Only the fresh retry introduces a new step name, so replay cannot mistake a rejected completion for the retry and previously recorded first-attempt output remains addressable.
- A rejected first attempt is valid while its writer remains `current_step`; a completed writer requires one final accepted attempt and exactly one matching accepted `model_usage` record. Two rejected attempts may terminate that writer without making it completed.
- Tagged `current_v1` and untagged historical rows remain strict. New code does not upgrade or reinterpret a `current_v1` run mid-flight; that compatibility path retains the old no-mechanical-retry behavior, while only a newly initialized `current_v2` run receives the retry policy.
- The D1 migration preserves all historical rows and permits `current_v1` and `current_v2`; edition provenance continues to contain only the two accepted writer usages.

Cloudflare assigns every Workflow instance a version ID and reports that identity when an instance is queued, started, or resumed. Because the public documentation does not explicitly promise code pinning across deploys, the compatibility rule above is a product-side invariant rather than an assumption about platform behavior.

## Verification path

Invoke `ebt-wsd:skeleton-walker` from its loaded skill directory with `--project-root /Users/epicbadtiming/Projects/personal/bitcraft/bc-news --require-probe`: the repository-owned walk observes a rejected initial completion, one fresh retry of only that writer, distinct retained attempt evidence, one valid published edition, no repeated accepted writer call, and `WALK PASS`.

## Residual risks

- Non-invariant: a second consecutive mechanical rejection still ends the run under the accepted one-retry production policy.
- Non-invariant: current operator status gains bounded attempt-history payload and historical-reader maintenance cost.
- Non-invariant: recorded replay proves orchestration and retention, not live-provider stochastic recovery behavior.
- Non-invariant: a `current_v1` run already in flight at deployment finishes under its historical no-mechanical-retry contract; the new retry guarantee begins with `current_v2` runs.

## Notes

Schema-valid editorial diagnostics remain publishable and do not consume the mechanical retry. Transport retries remain independently bounded by the existing Workflow step policy.

## Context

- Governed by the [bounded mechanical output retry shape](/docs/direction/2026-08-31-mechanical-output-retry.shape.md).
- Uses canonical generation and verification terms from the [operational domain model](/docs/direction/bc-news.model.md) and binding [domain model](/docs/DOMAIN.md).
- Preserves the durability and cost invariants in the binding [product requirements](/docs/PRD.md).
