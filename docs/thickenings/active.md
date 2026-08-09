---
type: thickening
title: >-
  Thickening: production-aligned LM Studio sampling evidence
description: >-
  Active WSD thickening for every live LM Studio surface to distinguish and truthfully retain provider-default behavioral and explicit deterministic sampling.
tags: [wsd, thickening, active, lm-studio]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-09T02:58:38Z"
---
# Thickening: production-aligned LM Studio sampling evidence

**Started:** 2026-08-08
**Git strategy:** commit-to-main — one accepted thickening at a time
**Cadence:** Loose

## Dimension

LM Studio sampling posture across production generation, benchmarks, fixture authoring, context measurement, and their retained evidence.

## Observable delta

- before: production and every live evaluation surface require explicit sampling, every native request sends all three overrides, and retained artifacts do not distinguish behavioral from deterministic intent.
- after: production and behavioral evaluations omit all three overrides, deterministic evaluations retain complete per-model tuples, every current artifact reports the posture truthfully, and historical artifacts keep their original semantics.

## Minimum surface

- Shared LM Studio configuration, provider inputs, and all-or-none native request construction.
- Generation Worker wiring and strict `MODEL_CONFIG` resolution for provider-default production behavior.
- Current benchmark, fixture-response, and context-result contracts, retention, browsing, and comparison while frozen historical contracts remain unchanged.
- Exact contracts, production and local evaluation declarations, operator examples, and binding documentation for omitted, explicit, partial, and invalid sampling.

## Verification path

- `pnpm --filter @bc-news/model-adapters test -- lmstudio-model-provider.test.ts` captures the native SDK options and observes all three sampler properties absent for omission and unchanged for an explicit tuple.
- `pnpm --filter @bc-news/generation test -- config.test.ts lmstudio-model-provider.test.ts` observes production configuration accepting omission and complete explicit sampling while rejecting partial or invalid tuples.
- `pnpm --filter @bc-news/eval test` and `pnpm --filter @bc-news/eval verify:evaluation-browse` prove the current posture-aware artifact lifecycle and unchanged version-dispatched history; the verifier ends `evaluation: evidence listed summarized and compared without verdicts`.
- `pnpm --filter @bc-news/eval eval -- benchmark run --fixture packages/fixtures --config .wsd/bcn-004-provider-default-behavior.json` against an already-loaded approved local model retains a completed provider-default behavioral run, whose `benchmark summary` reports the omitted-sampler posture.
- `pnpm --filter @bc-news/eval eval -- benchmark run --fixture packages/fixtures --config .wsd/bcn-004-explicit-deterministic.json` completes the ordered local-model roster and retains each exact tuple as deterministic context; fixture-authoring and context verifiers retain the same posture distinction.
- `/Users/epicbadtiming/.codex/plugins/cache/ebt-plugins/ebt-wsd/0.12.2/bin/wsd-walk --project-root /Users/epicbadtiming/Projects/personal/bitcraft/bc-news --require-probe` boots the composed recorded-provider product and ends in `WALK PASS`.

## Residual risks

- Non-invariant: LM Studio may change its own provider defaults across model or runtime versions; this capability guarantees truthful omission and observation, not fixed provider behavior.
- Non-invariant: provider-default outputs may vary across repeated behavioral runs; variance is evidence, not a test failure.

## Notes

Omission is all-or-nothing. Production behavior and all current artifact boundaries land together; reasoning controls, token limits, prompts, hosted adapters, and evidence-message sampling do not change.

## Context

- [Current shape](../direction/2026-08-08-lm-studio-sampling-postures.shape.md) — governs scope, cadence, strategy, and success.
- [Capability map](../direction/2026-08-08-production-aligned-lm-studio-sampling.map.md) — this is capability 1.
- [WSD domain model](../direction/bc-news.model.md) — supplies existing production and evaluation vocabulary.
