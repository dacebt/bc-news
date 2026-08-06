---
type: shape
title: >-
  Shape: real model evaluation harness
description: >-
  Session boundaries, cadence, and success signal for separating verification domains and retaining real model behavior as durable evaluation evidence.
tags: [wsd, direction, shape, evaluation, verification]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-06T18:45:48Z"
---
# Shape: real model evaluation harness

**Declared:** 2026-08-06
**Cadence:** Loose
**Git strategy:** commit-to-main — one accepted thickening at a time

## In scope

- Give tests, live model evaluation, recorded-replay acceptance, context measurement, fixture authoring, and the composed skeleton walk honest names and separate outcomes.
- Add a real model-evaluation command that retains benchmark runs, evaluation trials, and every step invocation incrementally, including rejected behavior and bounded transport retries.
- Continue independent editorial tracks and later declared trials when model behavior blocks only a dependent path; stop the benchmark when its own evidence cannot be trusted.
- Browse and compare completed, rejected, and infrastructure-incomplete trials over time without an automatic judge or quality verdict.
- Evaluate one representative fixture and sampling posture serially against the four authorized local models, while independently proving recorded replay and the composed product walk.

## Out of scope (deliberately)

- Prompt tuning, model selection, quality scoring, automatic judging, or a new production acceptance policy.
- Changes to production hard-failure or Cloudflare Workflow retry behavior, evidence selection, context-budget policy, or fixture contents.
- A third domain port, a generalized artifact repository, remote or paid inference, production access, deployment, release, or the separate runtime-prompt review task.

## Known risks

- Evidence written only after parsing would recreate the current successful-only blind spot; lifecycle and retry history must survive rejection and interruption.
- The two editorial tracks are logically independent even though the current local runner aborts them as one serial roster; dependency handling could silently discard useful behavior.
- Historical run files, recorded responses, context results, and new benchmark artifacts are incompatible evidence kinds and must not be silently relabeled or compared as one schema.

## Success signal

A local four-model benchmark over one declared fixture retains complete, rejected, and retried trial evidence and a cross-model summary, while the separately named recorded-replay acceptance gate and `pnpm walk -- --non-interactive` independently pass.

## Notes

The harness retains the exact assembled model-port request and the application-facing completion text returned by the existing provider port before editorial parsing; it does not add a byte-exact pre-normalization HTTP-envelope contract. After bounded retryable transport failures, provider unavailability or resource exhaustion closes only the affected trial as infrastructure-incomplete and the benchmark continues; invalid configuration or untrustworthy artifact state stops the benchmark.

## Related documentation

- [Real model evaluation capability map](2026-08-06-real-model-evaluation-harness.map.md) — risk-ordered verticals governed by this shape.
- [WSD domain model](bc-news.model.md) — operational vocabulary and bounded contexts for the work.
- [Test and verification posture](../TESTING.md) — binding evidence discipline to amend as the ownership split lands.
