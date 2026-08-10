---
type: thickening
title: >-
  Thickening: durable longitudinal scorecard series
description: >-
  Active WSD thickening for retaining comparable role scorecards over time and truthfully classifying context change, insufficient evidence, baseline variation, and potential drift.
tags: [wsd, thickening, active]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-10T15:04:00Z"
---
# Thickening: durable longitudinal scorecard series

**Started:** 2026-08-10
**Git strategy:** commit this coherent thickening directly to local `main`; no push
**Cadence:** Normal

## Dimension

Durable temporal comparison at the strict per-agent scorecard boundary.

## Observable delta

- before: an evaluator can build and audit four role-specific scorecards for one retained evaluation pack, but those observations have no deliberate durable series, baseline cohort, or truthful temporal classification.
- after: an evaluator retains selected scorecard audit packs in an ordered longitudinal series and browses each role's exact comparable cohort, supporting distributions, sample counts, uncertainty, and one explicit `context_changed`, `insufficient_evidence`, `within_baseline`, or `potential_drift` classification without receiving a winner, recommendation, threshold, or production verdict.

## Minimum surface

- A versioned strict longitudinal-series contract that retains an ordered declaration plus every selected scorecard audit pack needed to reconstruct its summaries. Scratch Benchmark Runs and scorecards may remain ignored; selected evidence is complete, internally hash-bound, exactly reconstructable, and repository-owned, with commit history as the durable audit boundary.
- Exact cohort identity over fixture/reference identity, prompt and output contracts, code provenance, declared role configuration, selected and responding model identity, and observable runtime fingerprint. Volatile prediction timing, throughput, stop reason, speculative counts, reasoning-content presence, output measurements, annotations, and reviews remain observations rather than execution-context identity.
- Role-specific baseline and subject partitions with an explicit repetition policy. Every longitudinal metric preserves its name, unit, denominator, observation count, sample count, uncertainty method, and exact source scorecards; tokens and latency remain separate descriptive distributions.
- A deterministic, inspectable four-state classifier: changed comparable identity yields `context_changed`; an otherwise comparable cohort that cannot meet the declared evidence minimum yields `insufficient_evidence`; only a sufficiently observed unchanged context can yield `within_baseline` or `potential_drift`. Potential drift is a descriptive evidence flag, never a model ranking, acceptance decision, retry trigger, publication threshold, or production gate.
- Eval-owned build/read/report and explicit CLI routes that render the durable series and all four role classifications while preserving Benchmark Run versions 1–7, the capability-3 scorecard contract, acceptance Run Files, production generation, prompts, retry behavior, and model selection.
- A repository-owned direct verifier and focused rejection tests that prove exact source reconstruction, cohort identity, temporal ordering, baseline/subject separation, uncertainty and distribution calculations, all four classifications, historical-version safety, and the absence of aggregate scoring or verdict fields.

## Verification path

`pnpm --filter @bc-news/eval verify:evaluation-longitudinal-scorecards` assembles controlled capability-3 audit packs through the real longitudinal builder, store, reader, and report path; proves durable reconstruction and four separate role histories with exact context identities, baseline and subject samples, named units and denominators, uncertainty, distinct token and latency distributions, and each classification; classifies under-sampled comparable evidence as insufficient and rejects missing, duplicate, reordered, detached, hash-mismatched, or fabricated supporting evidence; and ends exactly with `EVALUATION LONGITUDINAL SCORECARDS VERIFIED`. Project typecheck, lint, the full test suite, and `/Users/epicbadtiming/.codex/plugins/cache/ebt-plugins/ebt-wsd/0.12.2/bin/wsd-walk --require-probe --expect "WALK PASS"` then prove that the durable evaluation boundary did not regress the composed product.

## Residual risks

- Non-invariant: a deterministic potential-drift rule can expose an unusual changed distribution but cannot explain causality, editorial merit, or whether a production model should change.
- Non-invariant: the repository-authored verification history proves the evidence and classification contracts with controlled observations; it does not claim that any live model has drifted or that one candidate is superior.
- Non-invariant: retained audit packs deliberately grow repository history. Only selected complete packs belong in the longitudinal series; operational cleanup or external evidence storage remains outside BCN-006.

## Notes

Changed context and changed behavior answer different questions. A context mismatch stops drift comparison and is reported directly. Under an unchanged context, too little evidence stays insufficient; enough evidence can describe ordinary baseline variation or potential drift, but neither result is an editorial judgment or release gate.

## Context

- governed by the [longitudinal scorecard shape](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.shape.md)
- implements capability 4 of the [longitudinal scorecard map](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.map.md)
- uses the established vocabulary in the [evaluation and verification model](../direction/bc-news.model.md)
