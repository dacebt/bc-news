---
type: shape
title: >-
  Shape: hosted model scorecard authoring
description: >-
  Redeclared session boundary for four local scorecards with one-off ignored mechanical authoring helpers.
tags: [wsd, direction, shape, evaluation, scorecards]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-20T03:00:46Z"
---
# Shape: hosted model scorecard authoring

**Declared:** 2026-08-19
**Cadence:** Loose
**Git strategy:** commit-to-main

## In scope

- Author one local V3 scorecard declaration, Codex annotation bundle, and Codex qualitative-review bundle for each of the four hosted model configurations.
- Permit one-off ignored local helpers to assemble exact identities, hashes, UTF-16 spans, and JSON from agent-authored judgments; the helpers do not make or replace those judgments.
- Build and reopen one local V3 scorecard for each model from the 24 successful, corpus-aligned Benchmark V8 runs.
- Preserve exact V8 Gateway-request provenance and the complete six-fixture corpus order in every scorecard.

## Out of scope (deliberately)

- Product-source or scorecard-contract changes, a durable authoring command, hosted-model reruns, paid inference, prompt changes, adapter changes, or production model selection.
- Including the superseded MiniMax parse-rejected attempt or the Gemini and Luna pre-repair infrastructure observations in a scorecard declaration.
- Aggregate exports, cross-model ranking, winner selection, longitudinal analysis, deployment, push, or publication.
- Committing content-bearing declarations, annotations, reviews, benchmark evidence, scorecard artifacts, or the one-off ignored helpers.

## Known risks

- Mechanical assembly can prove identity and span exactness but cannot prove that a Codex judgment is substantively sound.
- MiniMax and Gemini evidence predates the current commit and will truthfully report descriptive `outdated` freshness.
- Parallel authoring must remain file-disjoint and independently reviewed so one model's judgments or identities cannot leak into another's scorecard.

## Success signal

Four independent V3 scorecards build from the selected six-run model rosters, each exact returned scorecard ID reopens successfully, and the controlled scorecard verifier passes.

## Notes

This remains an artifact-only evaluation capability. The prior scorecard shape is deprecated because it did not permit the mechanical assembly path required to materialize the review evidence safely.

## Related documentation

- [Prior hosted model scorecard shape](2026-08-19-hosted-model-scorecards.shape.md) — superseded boundary that omitted the required mechanical authoring path.
- [Hosted model evaluation expansion](2026-08-18-hosted-model-evaluation-expansion.shape.md) — governing source of the retained four-model Benchmark V8 matrix.
- [Domain model](bc-news.model.md) — vocabulary and boundaries for scorecards, annotations, qualitative reviews, and freshness.
- [Evaluation operations](../evaluation-operations.md) — operator commands and local artifact routes.
- [Direction index](index.md) — current and historical WSD session boundaries.
