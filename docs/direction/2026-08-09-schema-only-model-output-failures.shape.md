---
type: shape
title: >-
  Shape: Schema-only model-output failures
description: >-
  Session boundaries, cadence, and success signal for making every schema-valid editorial finding diagnostic rather than terminal.
tags: [wsd, direction, shape, generation, evaluation]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-09T14:28:32Z"
---
# Shape: Schema-only model-output failures

**Declared:** 2026-08-09
**Cadence:** Loose
**Git strategy:** commit-to-main — one accepted thickening at a time

## In scope

- Make malformed JSON or output that fails its declared schema the only terminal model-output failure in production and current evaluation.
- Run each writer and copyeditor once; when copyedit output is schema-valid, retain and use it without another inference call regardless of grammar, punctuation, markdown, wording, preservation, or editorial-policy findings.
- Retain all non-schema findings as inspectable diagnostics in production-shaped execution and current evaluation artifacts, reports, browse, and comparison surfaces.
- Version current evaluation semantics without reinterpreting retained versions 1–4; align focused contracts, tests, verifiers, binding docs, and the composed walk.
- Resume BCN-004 sampling evidence only after this boundary is proven, using the already selected sampler declarations rather than tuning around diagnostics.

## Out of scope (deliberately)

- Prompt rewriting, model or sampler tuning, extra repair passes, automatic judges, quality scores, or publication thresholds.
- Deterministic rewriting, sanitizing, or silently deleting model-authored content to satisfy editorial findings.
- BCN-005 parallel execution, hosted inference, deployment, publication, remote mutation, or rewriting retained historical artifacts.

## Known risks

- A diagnostic can accidentally remain wired to a retry, rejection, or publication stop on one production or evaluation path.
- Relaxing editorial findings must not weaken JSON parsing, schema validation, edition assembly validation, or separate transport and infrastructure outcomes.
- Current artifacts must show completed products with findings without changing the meaning of historical rejection outcomes.

## Success signal

A production-shaped run and a current evaluation each accept a schema-valid copyedit result containing representative preservation and editorial findings after one copyedit call, retain those findings as diagnostics, and complete without retry; malformed or schema-invalid JSON still stops at its boundary, historical artifacts still parse unchanged, and the composed recorded-provider walk ends in `WALK PASS`.

## Notes

The observed em dash is one example only. The boundary applies to the entire class of non-schema findings. Transport and infrastructure failures remain distinct from model-output failures.

## Related documentation

- [Superseded sampling shape](2026-08-08-lm-studio-sampling-postures.shape.md) — preserves the session whose live evidence exposed the incorrect rejection boundary.
- [Structural discipline](../ARCHITECTURE.md) — binds rejecting schemas and artifact-version compatibility.
- [Test and verification posture](../TESTING.md) — separates deterministic gates, retained behavioral evidence, and the composed walk.
- [WSD domain model](bc-news.model.md) — supplies the evaluation and verification vocabulary.
