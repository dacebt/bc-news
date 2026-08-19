---
type: shape
title: >-
  Shape: hosted model evaluation expansion
description: >-
  Session boundaries, loose cadence, and success signal for admitting Gemini 3.7 Flash and GPT-5.6 Luna and retaining a four-model hosted benchmark.
tags: [wsd, direction, shape, evaluation, hosted-models]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-19T02:25:57Z"
---
# Shape: hosted model evaluation expansion

**Declared:** 2026-08-18
**Cadence:** Loose
**Git strategy:** commit-to-main

## In scope

- Admit `google/gemini-3.7-flash` through the existing Cloudflare AI Gateway Chat Completions contract.
- Admit `openai/gpt-5.6-luna` through an exact Cloudflare AI Gateway Responses contract with strict structured output, response decoding, usage, sanitized failures, and retained request and runtime provenance.
- Align binding architecture and testing documentation plus the descriptive model register with the two admitted profiles.
- Run `minimax/m3`, `google/gemini-3.7-flash`, `openai/gpt-5.6-luna`, and `openai/gpt-5-nano` serially across the six-fixture production-grounded corpus and retain local Benchmark V8 evidence.

## Out of scope (deliberately)

- Prompt, sampling, retry, evaluation-score, corpus, or production model-selection changes.
- A general provider or transport framework beyond the exact Chat Completions and Responses contracts needed by these profiles.
- Production configuration changes, deployment, push, publication, or committing content-bearing evaluation evidence.
- Reusing, modifying, or deleting the ignored configs from the interrupted MiniMax/Gemma discussion.

## Known risks

- Luna uses a different endpoint, request schema, output envelope, usage vocabulary, and successful-but-incomplete status semantics from the existing Chat Completions adapter.
- Widened provenance must stay exact across generation, evaluation, retained V8 artifacts, errors, and recorded replay without weakening strict schemas.
- Hosted Gateway throttling can interrupt a corpus; each model and fixture must finish and verify before the next paid run begins.

## Success signal

The composed walk ends in `WALK PASS`, both new profiles complete their exact adapter and provenance contracts, and 24 terminal Benchmark V8 artifacts reopen successfully from the ignored local evidence root after four serial six-fixture hosted runs.

## Notes

This is one operator-visible capability, so no capability map is needed. Hosted inference begins only after the support thickening is accepted and committed; any red gate or run failure stops the cadence.

## Related documentation

- [Binding architecture](../ARCHITECTURE.md) — authority for model-port and Gateway transport boundaries.
- [Binding testing posture](../TESTING.md) — authority for retained hosted-model evidence.
- [Model admission and pricing](../model-pricing.md) — descriptive admitted-profile register and provider-owned pricing sources.
- [Direction index](index.md) — current and historical WSD session boundaries.
