---
type: shape
title: >-
  Shape: LM Studio sampling postures
description: >-
  Session boundaries, cadence, and success signal for aligning production and evaluation sampling intent.
tags: [wsd, direction, shape, lm-studio, evaluation]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-09T02:58:38Z"
---
# Shape: LM Studio sampling postures

**Declared:** 2026-08-08
**Cadence:** Loose
**Git strategy:** commit-to-main — one accepted thickening at a time

## In scope

- Make LM Studio sampling optional end to end; omission means production sends none of the SDK's temperature, top-p, or top-k overrides.
- Make production and behavioral evaluation use provider-default sampling while preserving complete, explicit per-model sampling for deterministic drift, structure, reliability, and completion evidence.
- Let benchmarks, single trials, fixture authoring, and context measurement declare and retain their sampling posture truthfully.
- Represent omitted versus explicit sampling in current artifacts without reinterpreting versions 1–3; align tests, examples, binding docs, local declarations, and representative evidence.

## Out of scope (deliberately)

- Reasoning-control, token-limit, prompt, editorial, evidence-selection, or evidence-message sampling changes.
- Hosted inference, Cloudflare AI Gateway, paid or remote model calls, deployment, publication, or production mutation.
- Rewriting retained historical artifacts, declaring a universal deterministic sampler, or promising byte-identical model output.

## Known risks

- Partial omission or guessed defaults would silently diverge from actual provider-default production behavior.
- Declared posture, sent request, retained evidence, and comparison view can become contradictory.
- Provider-default behavior is nondeterministic, so one successful response is insufficient representative evidence.

## Success signal

With an approved local model, a production-shaped generation and a behavioral evaluation omit all three LM Studio sampling overrides, a separately declared deterministic evaluation retains its explicit per-model sampler without being presented as a behavioral baseline, current artifacts browse truthfully while versions 1–3 still parse unchanged, and the independent recorded-provider `pnpm walk -- --non-interactive` ends in `WALK PASS`.

## Notes

Fixture authoring and context measurement are posture-configurable: the declaration, not the command name, determines their purpose.

## Related documentation

- [Capability map](2026-08-08-production-aligned-lm-studio-sampling.map.md) — keeps production-default behavior and its truthful behavioral evidence in one invariant-coupled capability.
- [Structural discipline](../ARCHITECTURE.md) — binds model-provider configuration and artifact-version compatibility.
- [Test and verification posture](../TESTING.md) — keeps live model evidence distinct from deterministic tests and the composed walk.
- [WSD domain model](bc-news.model.md) — supplies the existing evaluation and verification vocabulary.
