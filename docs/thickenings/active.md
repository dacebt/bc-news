---
type: thickening
title: >-
  Thickening: explicit per-agent evaluation scorecards
description: >-
  Active WSD thickening for turning retained run, source-reference, annotation, and manual-review evidence into four auditable role-specific scorecards.
tags: [wsd, thickening, active]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-10T13:20:08Z"
---
# Thickening: explicit per-agent evaluation scorecards

**Started:** 2026-08-10
**Git strategy:** commit this coherent thickening directly to local `main`; no push
**Cadence:** Normal

## Dimension

Role-specific measurement evidence and declared human review at the existing Benchmark Run and reference-corpus boundaries.

## Observable delta

- before: an evaluator can browse exact per-invocation model/runtime evidence and separately audit what each synthetic conversation establishes, but has no strict contract connecting retained output to named measurements or human review.
- after: an evaluator explicitly supplies retained comparable runs plus source-linked annotations and declared manual reviews, then receives four separate scorecards for `main_story_write`, `main_story_copyedit`, `announcements_write`, and `announcements_copyedit`; every value exposes its metric, unit, denominator, sample count, evidence identity, and applicability without producing an overall score, winner, threshold, or verdict.

## Minimum surface

- A versioned strict scorecard-input contract that binds every accepted run and annotation to exact Benchmark Run, configuration, trial, invocation, fixture, corpus-manifest, output, and runtime-evidence identities; detached, duplicate, incomplete, or fabricated inputs reject rather than being skipped.
- Exact output-span and qualified corpus-reference annotations from which the application deterministically calculates claim grounding and attribution, event coverage, and announcement-candidate relevance. Human semantic annotation remains visible evidence; calculated rates never masquerade as automatic understanding of creative prose.
- Role-appropriate deterministic measurements for invocation schema reliability, copyedit preservation, factual grounding/attribution, event coverage, announcement relevance, input/output tokens, application latency, and provider prediction timing. Every rate names numerator, denominator, denominator unit, sample count, comparable-context identity, and a 95% Wilson interval; tokens and latency remain separate descriptive dimensions; inapplicable or unavailable measurements are explicit.
- A separate versioned manual qualitative-review contract with reviewer identity, rubric version, criterion-level assessment, rationale, uncertainty, exact reviewed-output identity, and no hidden weighting. Coherence, usefulness, newsworthiness, and voice remain declared judgment rather than deterministic findings or model-generated review.
- Eval-owned build/read/report and explicit CLI routes that render exactly four role scorecards while leaving Benchmark Run versions 1–7, acceptance Run Files, production generation, retry behavior, prompts, and the reference corpus unchanged.
- A repository-owned direct verifier plus focused identity, completeness, denominator, annotation-linkage, metric, applicability, and review-rejection tests; binding testing and architecture prose deliberately narrowed only to permit transparent named scorecards while continuing to forbid opaque aggregate scores and acceptance verdicts.

## Verification path

`pnpm --filter @bc-news/eval verify:evaluation-scorecards` assembles controlled retained V7 invocation evidence for committed corpus fixtures through the real scorecard builder, reader, and report path; proves four role-specific outputs and exact named units, denominators, sample-count equations, comparable-context identities, 95% Wilson intervals, token/latency dimensions, annotation-derived rates, and manual-review identity; rejects missing roster members, detached spans/references, duplicate or incomplete denominators, fabricated runtime/usage values, review/output mismatch, hidden weighting, and overall verdict fields; and ends exactly with `EVALUATION SCORECARDS VERIFIED`. Project typecheck, lint, the full test suite, and `/Users/epicbadtiming/.codex/plugins/cache/ebt-plugins/ebt-wsd/0.12.2/bin/wsd-walk --require-probe --expect "WALK PASS"` then prove that the new evaluation-reporting boundary did not regress the composed product.

## Residual risks

- Non-invariant: this capability gives every observed rate its declared 95% Wilson interval but does not yet define a committed longitudinal baseline, baseline distribution, or drift classification; capability 4 owns those temporal policies.
- Non-invariant: source-linked factual and relevance annotations require declared human semantic work because creative paraphrase cannot be truthfully classified by substring matching alone.
- Non-invariant: one controlled verification pack proves the contracts and calculations, not the quality of any particular live model or temperature candidate; live, remote, and paid inference remain outside this run.

## Notes

The application calculates transparent quantities from retained evidence; it does not invent semantic labels. Manual factual/relevance annotations and qualitative reviews are separate strict inputs with visible authorship and rationale. A scorecard is a role-specific evidence report, never a weighted model-wide score, automatic judge, recommendation, acceptance decision, production gate, or retry trigger.

## Context

- governed by the [longitudinal scorecard shape](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.shape.md)
- implements capability 3 of the [longitudinal scorecard map](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.map.md)
- uses the established vocabulary in the [evaluation and verification model](../direction/bc-news.model.md)
