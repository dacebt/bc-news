---
type: capability-map
title: >-
  Capability map: real model evaluation harness
description: >-
  Risk-ordered vertical capabilities and feature conventions for retaining and comparing real model behavior without conflating verification domains.
tags: [wsd, direction, capability-map, evaluation, verification]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-18T15:13:37Z"
---
# Capability map: real model evaluation harness

**Declared:** 2026-08-06
**Domain model:** [bc-news evaluation and verification](bc-news.model.md)

## New conventions

- New benchmark evidence has its own strict lifecycle and storage identity; historical successful run files, recorded fixtures, and context results keep their existing meanings.
- Evaluation owns explicit bounded transport retries, and every invocation is immutable evidence linked to its predecessor rather than an overwritten attempt.
- A rejected dependent path does not suppress an independent editorial track or a later declared trial; only invalid configuration or untrustworthy evidence stops the benchmark.
- Comparison reports behavioral change and provenance without producing a quality score, judge verdict, or acceptance decision.

## Capabilities

1. **A developer runs one real-model trial and can inspect durable evidence whether its editorial output completes or is rejected.** — Walking skeleton through the production request builders, model port, incremental evidence boundary, existing parsers and preservation rules, and a typed trial outcome.
2. **A developer runs a serial benchmark that retains linked transport retries, completes independent editorial tracks, and continues to later trials after model rejection or provider exhaustion.** — Extends the walking path across lifecycle branching and the benchmark-level stop policy without changing production retry behavior.
3. **A developer lists, shows, summarizes, and compares completed, rejected, and infrastructure-incomplete benchmark trials over time.** — Makes the retained evidence usable for longitudinal model evaluation without silently reinterpreting historical artifacts or adding a verdict.
4. **A developer invokes live evaluation, fixture authoring, context measurement, recorded-replay acceptance, and the composed skeleton walk as honestly named independent surfaces.** — Closes the ownership split and proves it with the representative four-local-model benchmark plus separate acceptance and walk results.

## Order rationale

Incremental retention at the model-to-parser seam is the architectural risk and must walk first. Retry and continuation then exercise the evidence lifecycle; browsing and comparison depend on that stable artifact, and the final ownership split binds every developer-facing surface only after the real evaluation path exists.

## Notes

Artifact persistence remains an eval-application boundary under the existing two-port architecture. Byte-exact provider envelopes, model-quality policy, and production orchestration changes are not hidden prerequisites.

## Related documentation

- [Paired historical shape](2026-08-06-real-model-evaluation-harness.shape.md) — session boundary that governed this map.
- [WSD domain model](bc-news.model.md) — vocabulary authority for these capabilities.
- [Structural discipline](../ARCHITECTURE.md) — binding two-port constraint this carve preserves.
