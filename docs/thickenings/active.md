---
type: thickening
title: >-
  Thickening: schema-valid editorial completion
description: >-
  Active WSD thickening for completing every schema-valid paper after one copyedit pass while retaining all non-schema findings as diagnostics.
tags: [wsd, thickening, active, generation, evaluation]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-09T14:33:07Z"
---
# Thickening: schema-valid editorial completion

**Started:** 2026-08-09
**Git strategy:** commit-to-main — one accepted thickening at a time
**Cadence:** Loose

## Dimension

Model-output acceptance and diagnostic retention across the production editorial workflow and its current evaluation evidence.

## Observable delta

- before: schema-valid copyedit output can still be rejected by preservation or editorial-policy findings, discarding a usable paper even though no structural output contract failed.
- after: each writer and copyeditor runs once, every schema-valid copyedit product continues through deterministic edition assembly, every non-schema finding remains inspectable, and only malformed or schema-invalid model output is terminal.

## Minimum surface

- Generation-core parsing and diagnostic derivation for both editorial products, plus production Workflow retention and status projection without an extra inference call.
- Current evaluation execution, artifact version, lifecycle, outcome counts, reports, browse, comparison, and strict historical version dispatch.
- Reproduced-boundary tests, binding architecture and verification documentation, representative recorded-provider evidence, and the composed walk.

## Verification path

- Focused production and evaluation verifiers exercise schema-valid outputs carrying multiple preservation and editorial findings and observe one writer call, one copyedit call, a completed product, and retained diagnostics; paired malformed-JSON and schema-mismatch cases remain terminal.
- `pnpm walk -- --non-interactive` drives the real Workflow with recorded responses containing representative non-schema findings, serves the assembled edition, exposes the diagnostics in operator state, and ends in `WALK PASS` without any additional model call.

## Residual risks

- Non-invariant: existing local-model evidence remains behaviorally variable and may retain different diagnostics across repeated runs.
- Non-invariant: the exact diagnostic vocabulary can grow later, provided new findings remain non-terminal and versioned evidence stays truthful.

## Notes

The em dash that reproduced the defect is only one example. No grammar, punctuation, syntax-quality, markdown, wording, preservation, or editorial-policy finding may become a terminal shortcut.

## Context

- [Schema-only model-output failures shape](../direction/2026-08-09-schema-only-model-output-failures.shape.md) — governs the acceptance boundary and session cuts.
- [Evaluation and verification domain model](../direction/bc-news.model.md) — supplies the retained-evidence vocabulary.
- [Binding structural discipline](../ARCHITECTURE.md) — owns rejecting schemas and artifact-version compatibility.
- [Binding verification posture](../TESTING.md) — owns independent evidence domains and the composed walk.
