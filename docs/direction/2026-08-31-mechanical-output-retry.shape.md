---
type: shape
title: >-
  Shape: bounded mechanical output retry
description: >-
  Loose-cadence session boundary for retrying one mechanically invalid writer completion without publishing invalid output or repeating accepted work.
tags: [wsd, direction, shape, generation, retries, model-output]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-31T19:22:55Z"
---
# Shape: bounded mechanical output retry

**Declared:** 2026-08-31
**Cadence:** Loose
**Git strategy:** commit-to-main

## In scope

- Give each production writer one fresh automatic retry when its first completion fails the editorial output contract, while keeping invalid output out of assembly and publication.
- Retry only the failed writer, preserve prepared evidence and accepted earlier writer work, and keep transport retries separate from the mechanical retry allowance.
- Retain truthful attempt identity, outcome, usage, and cost evidence in operator status while edition provenance continues to describe only the accepted writer products.
- Preserve strict historical readers while aligning the operational domain model and binding architecture and testing documentation with the new current production contract.
- Prove malformed JSON, schema mismatch, and invalid identity/reference-token recovery with focused tests and a probe-backed repository walk.

## Out of scope (deliberately)

- Operator-initiated restart after the automatic retry is exhausted, more than one mechanical retry, fallback-model routing, or transport retry-policy changes.
- Prompt tuning, announcement relevance changes, schema-valid editorial diagnostics, deterministic output coercion, or publication of invalid output.
- Hosted or local live-model inference, production access, deployment, publication, push, or release work.

## Known risks

- Durable Workflow step identity can accidentally replay the rejected completion instead of creating a fresh invocation.
- Attempt evidence can drift from billing truth or corrupt historical status parsing if current and legacy contracts are not separated explicitly.
- Retrying announcements must not repeat an accepted main-story call, and retry exhaustion must never leak a partial edition.
- A deployment must not reinterpret an already-running `current_v1` status as the new retry contract; new code preserves a strict historical compatibility path regardless of platform version-pinning behavior.

## Success signal

The probe-backed local walk intentionally rejects an initial mechanical completion, observes one fresh failed-writer retry with distinct retained attempt evidence, publishes exactly one valid edition without repeating accepted writer work, and ends in `WALK PASS`.

## Notes

This session implements the one-retry production policy recorded in ADR-030. The capability is one vertical, so no capability map is needed; the operational domain model must distinguish a rejected completion from an exhausted generation run.

## Related documentation

- [Binding architecture](../ARCHITECTURE.md) — owns Workflow durability, provider boundaries, and status contracts.
- [Binding testing posture](../TESTING.md) — owns deterministic and composed-walk evidence.
- [Binding product requirements](../PRD.md) — requires bounded spending, durable work, and duplicate-safe publication.
- [Direction index](index.md) — current and historical WSD direction artifacts.
