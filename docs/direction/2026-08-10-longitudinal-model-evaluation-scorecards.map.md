---
type: capability-map
title: >-
  Capability map: longitudinal per-agent model evaluation scorecards
description: >-
  Risk-ordered vertical capabilities and feature conventions for observable runtime evidence, reference-backed review, and honest longitudinal comparison.
tags: [wsd, direction, capability-map, evaluation, scorecards, drift]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-18T15:13:37Z"
---
# Capability map: longitudinal per-agent model evaluation scorecards

**Declared:** 2026-08-10
**Domain model:** [bc-news evaluation and verification](bc-news.model.md)

## New conventions

- Runtime evidence is normalized and application-owned, with explicit observed, unknown, or externally controlled state; raw provider configuration blobs are not historical evidence contracts. The comparable execution-context fingerprint excludes volatile prediction observations such as latency, throughput, stop reason, speculative counts, and reasoning-content presence.
- Chat fixtures remain the model's source evidence. Separate reference records identify facts, events, ambiguities, and noteworthy candidates without prescribing prose, angle, structure, or voice.
- Reviews declare rubric version, reviewer identity, rationale, and uncertainty. Deterministic measurements and qualitative judgment never masquerade as each other.
- Every scorecard value is role-specific and names its metric, unit, denominator, sample count, and exact comparable-context identity. There is no weighted model-wide score.
- Scratch Benchmark Runs may remain ignored. A committed longitudinal series retains the summaries and supporting evidence required to audit them.
- Changed fixture, prompt or output contract, code provenance, declared configuration, model identity, or observable runtime fingerprint creates changed context. Only repeated observations inside one exact context can contribute evidence of potential drift.
- Rate metrics use a declared 95% interval; tokens and latency remain descriptive distributions. Classifications are `context_changed`, `insufficient_evidence`, `within_baseline`, or `potential_drift`, never acceptance or production decisions.

## Capabilities

1. **An evaluator runs one benchmark and can inspect truthful normalized runtime evidence for every model invocation.** — Introduces the next strict Benchmark Run version, a comparable execution-context fingerprint separated from volatile prediction observations, explicit unknown and externally controlled states, and current browse surfaces while preserving versions 1–6.
2. **An evaluator selects an ordered varied corpus and can audit what each conversation establishes without being handed a target article.** — Adds the manifest, synthetic chat fixtures, separate claim/event/ambiguity/noteworthy reference records, strict readers, and fixture-level browsing needed to evaluate creative outputs against known source evidence.
3. **An evaluator reviews retained output and receives four explicit per-agent scorecards.** — Connects exact invocations to deterministic schema, preservation, grounding, attribution, coverage, relevance, token, and latency measurements plus declared manual qualitative reviews, always with visible units and denominators.
4. **An evaluator compares durable repeated scorecards over time and sees whether the context changed, evidence is insufficient, behavior remains within its baseline, or potential drift is observable.** — Adds committed audit packs, exact cohort identity, sample distributions and uncertainty, longitudinal browsing, and the final documentation and verification boundary without creating a judge or quality gate.

## Order rationale

The runtime fingerprint is the first dependency because a baseline cannot be interpreted without knowing what actually ran. The corpus then establishes independent source truth before any scoring contract exists. Per-agent scorecards consume both evidence halves, and longitudinal classification comes last because it is only honest after repeated, exactly comparable role-specific observations exist.

## Related documentation

- [Successor commit-addressed shape](2026-08-10-commit-addressed-evaluation-evidence.shape.md) — supersedes this actor-visible carve's original evidence-storage boundary.
- [Paired historical shape](2026-08-10-longitudinal-model-evaluation-scorecards.shape.md) — cadence, scope, cuts, risks, and success signal that governed this map.
- [WSD domain model](bc-news.model.md) — existing Benchmark Run, trial, track, invocation, and verification vocabulary.
- [Binding testing posture](../TESTING.md) — owns the separation between evaluation observations and acceptance.
- [Binding architecture](../ARCHITECTURE.md) — owns strict artifacts and the two-port constraint.
