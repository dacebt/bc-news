---
type: thickening
title: >-
  Thickening: four hosted model scorecards
description: >-
  Active WSD thickening for building and reopening four local V3 scorecards from the completed hosted benchmark matrix.
tags: [wsd, thickening, active, evaluation, scorecards]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-19T06:00:07Z"
---
# Thickening: four hosted model scorecards

**Started:** 2026-08-19
**Git strategy:** commit-to-main
**Cadence:** Loose

## Dimension

Local evaluation measurement for the completed four-model hosted benchmark matrix.

## Observable delta

- before: the local store contains 24 successful corpus-aligned Benchmark V8 runs, but no scorecards for those hosted configurations.
- after: the local store contains one validated and reopenable V3 scorecard for each hosted model, with complete Codex annotations, qualitative reviews, and exact V8 provenance.

## Minimum surface

- Four ignored V3 scorecard declarations selecting exactly one successful run for each ordered corpus fixture.
- Four ignored V2 Codex annotation bundles covering every parse-success output with exact spans and source-linked assessments.
- Four ignored V2 Codex qualitative-review bundles covering every parse-success output against the declared rubric.
- One-off ignored local helpers that mechanically assemble identities, hashes, UTF-16 spans, and JSON from explicit agent-authored judgments, then leave no product-source change.
- Four ignored V3 scorecard artifacts produced and read back through the existing CLI and store.

## Verification path

- Run `pnpm --filter @bc-news/eval eval -- scorecard build --input <declaration>` for each model; each command emits a V3 scorecard report.
- Run `pnpm --filter @bc-news/eval eval -- scorecard show <scorecard-id>` for every exact returned ID; each artifact reconstructs and reports successfully.
- Run `pnpm --filter @bc-news/eval verify:evaluation-scorecards`; the controlled contract proof reaches its success marker.

## Residual risks

- Non-invariant: MiniMax and Gemini scorecards will report descriptive `outdated` freshness because their evaluated commits precede current `HEAD`.
- Non-invariant: Codex annotations and qualitative reviews are explicit judgments whose uncertainty remains visible in the artifacts.
- Non-invariant: the three superseded failed observations remain retained beside the selected runs but are not summarized by these scorecards.

## Notes

The four owned evidence directories are exactly `apps/eval/local-data/scorecard-evidence/hosted-20260818-minimax-m3/`, `apps/eval/local-data/scorecard-evidence/hosted-20260818-gemini-3.7-flash/`, `apps/eval/local-data/scorecard-evidence/hosted-20260818-gpt-5.6-luna/`, and `apps/eval/local-data/scorecard-evidence/hosted-20260818-gpt-5-nano/`; every source reference is canonical and relative to `apps/eval/local-data`. The corpus order is dense, market, achievement, contested, discovery, sparse. Exclude the MiniMax parse-rejected attempt and the Gemini and Luna pre-repair infrastructure observations. The successful Luna dense run remains selected even though one invocation used its declared transport retry. Mechanical helpers may assemble evidence but must not synthesize the substantive judgments.

## Context

- [Hosted model scorecard authoring shape](../direction/2026-08-19-hosted-model-scorecard-authoring.shape.md) — redeclared session boundary and success signal.
- [Evaluation domain model](../direction/bc-news.model.md) — scorecard, annotation, review, and freshness vocabulary.
- [Evaluation operations](../evaluation-operations.md) — operator commands and local artifact routes.
