---
type: capability-map
title: >-
  Capability map: LM Studio sampling postures
description: >-
  Risk-ordered vertical capabilities and feature conventions for provider-default and explicit LM Studio sampling.
tags: [wsd, direction, capability-map, lm-studio, evaluation]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-09T01:41:33Z"
---
# Capability map: LM Studio sampling postures

**Declared:** 2026-08-08
**Domain model:** [bc-news evaluation and verification](bc-news.model.md)

## New conventions

- Provider-default posture omits the complete sampling tuple and all three corresponding SDK properties; application-chosen substitutes are not provider defaults.
- Explicit posture declares one complete, model-specific sampling tuple; a partial tuple is invalid and explicit sampling does not promise byte identity.
- Behavioral evidence uses production's provider-default posture; deterministic drift and reliability evidence uses the explicit posture and is never labeled as a production-behavior baseline.
- Current evidence states the declared posture and effective request truthfully; artifact versions 1–3 retain their historical semantics.

## Capabilities

1. **An operator runs production-shaped LM Studio generation with provider-default sampling while a deliberately configured complete sampler still works.** — Establishes the highest-risk omission semantics at the shared provider boundary before evaluation depends on them.
2. **An evaluator declares, runs, retains, and browses a provider-default behavioral evaluation without changing the meaning of historical evidence.** — Extends the production posture through live evaluation and the current artifact boundary.
3. **An evaluator declares, runs, retains, and browses explicit per-model deterministic evidence on any live evaluation surface without it being presented as a behavioral baseline.** — Completes the intent split for drift, reliability, fixture authoring, and context measurement after the truthful artifact path exists.

## Order rationale

The composed recorded-provider acceptance spine is already green. Production omission semantics set the shared contract; behavioral evidence depends on it, and deterministic evidence then reuses the truthful intent boundary.

## Notes

The WSD domain model remains unchanged until a running-system observation warrants new vocabulary under its update protocol.

## Related documentation

- [Current shape](2026-08-08-lm-studio-sampling-postures.shape.md) — session boundary governing this map.
- [WSD domain model](bc-news.model.md) — existing vocabulary authority for model evaluation and verification.
- [Structural discipline](../ARCHITECTURE.md) — binding provider-port and artifact-version constraints.
- [Test and verification posture](../TESTING.md) — binding separation between evaluation, acceptance, tests, and the composed walk.
