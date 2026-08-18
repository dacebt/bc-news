---
type: capability-map
title: >-
  Capability map: production-aligned LM Studio sampling
description: >-
  The invariant-coupled capability and feature conventions for truthful provider-default and explicit LM Studio sampling postures.
tags: [wsd, direction, capability-map, lm-studio, evaluation]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-18T14:53:44Z"
---
# Capability map: production-aligned LM Studio sampling

**Declared:** 2026-08-08
**Domain model:** [bc-news evaluation and verification](bc-news.model.md)

## New conventions

- Provider-default posture omits the complete sampling tuple and all three corresponding SDK properties; application-chosen substitutes are not provider defaults.
- Explicit posture declares one complete, model-specific sampling tuple; a partial tuple is invalid and explicit sampling does not promise byte identity.
- Behavioral evidence uses production's provider-default posture; deterministic drift and reliability evidence uses the explicit posture and is never labeled as a production-behavior baseline.
- Current evidence states the declared posture and effective request truthfully; artifact versions 1–3 retain their historical semantics.

## Capabilities

1. **An operator and evaluator choose provider-default behavioral or complete explicit deterministic LM Studio sampling on every live surface, with production using provider defaults and every current artifact retaining the posture truthfully while versions 1–3 keep their historical semantics.** — Shared configuration, request identity, and artifact-version invariants make the two postures one indivisible vertical.

## Order rationale

The composed recorded-provider acceptance spine is green. Production, benchmark, fixture-authoring, and context-measurement surfaces share configuration or request identity, so no truthful intermediate commit exists between the two postures.

## Notes

This carve supersedes the three-capability map after pre-construction seam review and consumer tracing exposed artifact-version and shared-configuration invariants across every live surface.

Historical outcome: `8af8233` implemented the all-or-none sampling posture described above. `30cc89f` later superseded it with independent per-agent optional temperature; [structural discipline](../ARCHITECTURE.md) owns the current request contract.

## Related documentation

- [Current shape](2026-08-08-lm-studio-sampling-postures.shape.md) — session boundary governing this map.
- [WSD domain model](bc-news.model.md) — existing vocabulary authority for model evaluation and verification.
- [Current structural discipline](../ARCHITECTURE.md) — binding authority for independent per-agent optional temperature and truthful artifact-version boundaries.
- [Test and verification posture](../TESTING.md) — separates behavioral evidence, deterministic evidence, tests, and the composed walk.
