---
type: shape
title: >-
  Shape: hosted model scorecards
description: >-
  Session boundaries, loose cadence, and success signal for four local scorecards built from the completed hosted benchmark matrix.
tags: [wsd, direction, shape, evaluation, scorecards]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-19T06:00:07Z"
---
# Shape: hosted model scorecards

**Declared:** 2026-08-19
**Cadence:** Loose
**Git strategy:** commit-to-main

## In scope

- Author one local V3 scorecard declaration, Codex annotation bundle, and Codex qualitative-review bundle for each of the four hosted model configurations.
- Build and reopen one local V3 scorecard for each model from the 24 successful, corpus-aligned Benchmark V8 runs.
- Preserve exact V8 Gateway-request provenance and the complete six-fixture corpus order in every scorecard.

## Out of scope (deliberately)

- Hosted-model reruns, paid inference, prompt or adapter changes, and production model selection.
- Including the superseded MiniMax parse-rejected attempt or the Gemini and Luna pre-repair infrastructure observations in a scorecard declaration.
- Aggregate exports, cross-model ranking, winner selection, longitudinal analysis, deployment, push, or publication.
- Committing content-bearing declarations, annotations, reviews, benchmark evidence, or scorecard artifacts.

## Known risks

- Exact-span annotations can drift from parsed output text unless every bundle is validated through the scorecard loader.
- MiniMax and Gemini evidence predates the current commit and will truthfully report descriptive `outdated` freshness.
- Codex annotation and qualitative-review judgments must remain explicit evidence rather than being presented as deterministic facts or a model ranking.

## Success signal

Four independent V3 scorecards build from the selected six-run model rosters, each exact returned scorecard ID reopens successfully, and the controlled scorecard verifier passes.

## Notes

This is an artifact-only evaluation capability. Existing scorecard contracts already accept the V8 evidence, so no source-code change is planned.

## Related documentation

- [Hosted model evaluation expansion](2026-08-18-hosted-model-evaluation-expansion.shape.md) — governing source of the retained four-model Benchmark V8 matrix.
- [Domain model](bc-news.model.md) — vocabulary and boundaries for scorecards, annotations, qualitative reviews, and freshness.
- [Evaluation operations](../evaluation-operations.md) — operator commands and local artifact routes.
- [Direction index](index.md) — current and historical WSD session boundaries.
