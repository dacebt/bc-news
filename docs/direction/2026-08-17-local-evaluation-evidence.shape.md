---
type: shape
title: >-
  Shape: local-only production evaluation evidence
description: >-
  Session boundaries, loose cadence, and success signal for replacing committed evaluation data with a private local evidence workflow and safe aggregate exports.
tags: [wsd, direction, shape, evaluation, privacy]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-19T02:25:57Z"
---
# Shape: local-only production evaluation evidence

**Declared:** 2026-08-17
**Cadence:** Loose
**Git strategy:** commit each coherent thickening directly to local `main`; no push, deployment, release, or model inference

## In scope

- Keep the evaluation harness, strict contracts, CLI, verification, and documentation in Git while moving snapshots and all content-bearing evaluation evidence under one ignored local root.
- Extract and curate six exact production-grounded cases from the 2026-08-16 snapshot through the unchanged preparation path.
- Build and reopen scorecard and longitudinal evidence from contained hash-verified local files rather than Git objects.
- Export only a strict aggregate JSON summary that cannot retain source or model-output content.
- Remove historical evaluation corpora and evidence from the current tree without rewriting Git history, and align binding documentation and decisions with the replacement.

## Out of scope (deliberately)

- Running local or hosted models, selecting a production model, changing prompts, sampling, retries, publication, deployment, or production behavior.
- Changing the 300-message or 13-per-UTC-hour preparation sampler.
- Deleting ignored local artifacts, rewriting repository history, or publishing private evaluation evidence.
- Running the complete 13-region finalist stress test; this session only preserves the later path for it.

## Known risks

- A derived artifact can leak private chat even when its source fixture is ignored; commit eligibility must be enforced by a whitelist-only schema.
- Local references must remain relocatable and tamper-evident without accepting absolute paths, traversal, or symlink escape.
- Removing the committed corpus can silently hollow out verification unless tests replace it with small generated synthetic evidence.

## Success signal

The CLI extracts the six selected cases from the verified local snapshot with exact 385-raw/149-prepared counts, validates local evidence and controlled scorecard flows, emits a strict content-free aggregate JSON, leaves all private files ignored and all historical eval data untracked from HEAD, and the composed recorded-replay walk ends in `WALK PASS`.

## Notes

Production chat and model outputs are untrusted local evidence. Build agents may use synthetic controlled fixtures only; production corpus curation stays with the root operator.

## Related documentation

- [Capability map](2026-08-17-local-evaluation-evidence.map.md) — risk-ordered actor-visible carve for this replacement.
- [Evaluation and verification model](bc-news.model.md) — operational vocabulary to update with local evidence and aggregate exports.
- [Binding testing posture](../TESTING.md) — verification-domain authority.
- [Binding architecture](../ARCHITECTURE.md) — data-boundary authority.
