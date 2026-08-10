---
type: shape
title: >-
  Shape: longitudinal per-agent model evaluation scorecards
description: >-
  Session boundaries, cadence, and success signal for auditable role-specific model evaluation across a varied reference corpus and comparable runs.
tags: [wsd, direction, shape, evaluation, scorecards, drift]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-10T04:16:59Z"
---
# Shape: longitudinal per-agent model evaluation scorecards

**Declared:** 2026-08-10
**Cadence:** Normal
**Git strategy:** commit coherent thickenings directly to local `main`; no push, deployment, release, or production access

## In scope

- Extend the current strict Benchmark Run contract with a new historical-version-safe evidence version that retains a normalized, observable runtime fingerprint for every model invocation and represents unavailable settings as unknown or externally controlled.
- Introduce a repository-authored, deliberately varied synthetic chat corpus with separate versioned reference evidence for facts, source events, ambiguities, names, numbers, and noteworthy candidates. Reference evidence constrains factual evaluation without prescribing one target article.
- Retain explicit manual qualitative reviews with declared reviewer identity, rubric version, rationale, and uncertainty alongside deterministic claim, event, relevance, preservation, schema, token, and latency measurements.
- Produce durable scorecards for `main_story_write`, `main_story_copyedit`, `announcements_write`, and `announcements_copyedit`. Every metric names its unit, denominator, sample count, and experimental context; tokens and latency remain separate dimensions.
- Group repeated observations only when fixture, prompt and output contracts, code provenance, declared agent configuration, model identity, and observable runtime fingerprint are comparable. Report changed context separately from insufficient evidence, baseline variation, and potential behavioral drift.
- Deliberately amend the binding testing and architecture documentation so transparent evaluation measurements and scorecards are permitted while opaque aggregate scores, automatic judges, acceptance verdicts, retries, publication thresholds, and production gates remain forbidden.
- Record the approved durable-evidence and statistical policy as an architectural decision, then make the direct eval CLI, verifiers, tests, and composed walk prove the resulting boundaries.

## Out of scope (deliberately)

- Selecting or changing production models, prompts, sampling policy, retry behavior, publication behavior, or the four-step writer-to-copyeditor topology.
- An evaluator-model judge, automatic qualitative review, weighted overall quality number, winner declaration, product threshold, or deterministic acceptance gate over model quality.
- Reinterpreting or rewriting Benchmark Run versions 1–6, historical acceptance Run Files, recorded responses, or context results.
- External dataset acquisition, production data, remote or paid inference, deployment, release, push, or production cutover.
- Fixing the separately surfaced intermittent recorded-response lock-contention defect.

## Known risks

- The LM Studio SDK exposes useful runtime observations alongside deprecated or unstable raw configuration surfaces; retaining provider blobs would create false precision and a brittle historical contract.
- Synthetic reference evidence can accidentally prescribe prose or smuggle subjective editorial choices into factual measurements unless references and reviews remain separate, explicit contracts.
- Small samples can look decisive. A scorecard that omits denominators, intervals, or comparable-context identity would turn noise into a ranking.
- Qualitative coherence, usefulness, newsworthiness, and voice require declared human judgment; they cannot be inferred from deterministic grammar diagnostics or silently automated.
- Durable evidence can grow quickly. The committed audit boundary must retain what supports a scorecard without turning every scratch run into repository history.
- Existing documentation says evaluation produces no score. The same unit must narrow that prohibition deliberately without weakening ADR-018's schema-only hard-failure boundary.

## Success signal

A repository-owned command loads a committed multi-fixture corpus and retained comparable observations, validates their runtime, reference, review, and provenance contracts, and renders four per-agent longitudinal scorecards with named units, denominators, sample counts, uncertainty, separate token and latency distributions, and an explicit `context_changed`, `insufficient_evidence`, `within_baseline`, or `potential_drift` classification. The supporting evidence is directly auditable, historical artifact versions keep their meanings, the strongest direct eval verifiers pass, and the independently composed product still ends in `WALK PASS`.

## Notes

The corpus is synthetic and test-only: each conversation establishes its own ground truth through separate reference records. Models remain free to choose angle, wording, structure, and voice, including under different per-agent temperatures. Rate intervals use a declared 95% method; tokens and latency expose descriptive distributions rather than being folded into editorial quality. Potential drift is an observation under an exactly comparable context, never a production verdict.

## Related documentation

- [Capability map](2026-08-10-longitudinal-model-evaluation-scorecards.map.md) — risk-ordered actor-visible slices governed by this shape.
- [Evaluation and verification model](bc-news.model.md) — established vocabulary and bounded contexts.
- [Binding testing posture](../TESTING.md) — verification-domain authority that this unit deliberately narrows.
- [Binding architecture](../ARCHITECTURE.md) — two-port and strict evidence-boundary authority.
