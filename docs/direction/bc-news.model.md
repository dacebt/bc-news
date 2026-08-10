---
type: domain-model
title: >-
  Domain model: bc-news evaluation and verification
description: >-
  Operational ubiquitous-language glossary and bounded contexts for bc-news evaluation and verification.
tags: [wsd, direction, domain-model, evaluation, verification]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-10T04:53:07Z"
---
# Domain Model: bc-news evaluation and verification

**Last updated:** 2026-08-10
**Update reason:** explicit per-agent scorecards — bind retained model behavior to transparent measurements and declared human review.

## Ubiquitous Language

| Term | Definition | Not to be confused with |
|---|---|---|
| Test | An isolated deterministic proof that code behavior meets assertions. | Model evaluation |
| Model evaluation | Observation and retention of model behavior on declared inputs, including malformed, schema-invalid, infrastructure-incomplete, and schema-valid diagnostic-bearing behavior. | Acceptance gate |
| Acceptance gate | Explicit policy that consumes evidence and returns an accept or reject decision. | Skeleton walk |
| Skeleton walk | End-to-end observation that the composed deployable product runs. | Model-quality evidence |
| Benchmark run | One declared experiment: fixture, prepared evidence, configuration matrix, repetitions, trials, and harness outcome. | Generation run |
| Evaluation trial | One model configuration evaluated against one declared fixture across both editorial tracks. | Step invocation |
| Step invocation | One actual request to one model for one production step; every retry is a new retained invocation. | Evaluation trial |
| Subject outcome | The typed behavior observed from the model: completed, parse-rejected, contract-rejected, or infrastructure-incomplete. | Harness outcome |
| Harness outcome | Whether the evaluation program retained valid, trustworthy evidence for its declared observation. | Subject outcome |
| Evaluation finding | A structured parse, contract, preservation, or final-product observation derived from retained evidence. | Quality verdict |
| Editorial diagnostic | A retained non-terminal preservation or final-product finding on schema-valid copyedit output. | Model-output contract failure |
| Model-output contract failure | Malformed JSON or strict schema mismatch; the only terminal model-output failure. | Infrastructure failure or editorial diagnostic |
| Production model step | One of the four configured writer or copyeditor calls in a generation run or evaluation trial. | Step invocation |
| Runtime evidence record | One top-level Benchmark Run record whose identity and lifecycle exactly match one Step Invocation. | Model usage record |
| Execution context | Normalized runtime observations that identify what comparable model environment executed an invocation. | Prediction observation |
| Prediction observation | Volatile response behavior such as stop reason, timing, throughput, speculative counts, and reasoning-content presence. | Execution context |
| Runtime observation | One strict field state: observed, unknown with a reason, or externally controlled with a reason. | A guessed provider setting |
| Evaluation reference corpus | One explicitly selected ordered set of synthetic conversations, each byte-paired with separate source-witness reference evidence. | A Benchmark Run or target article |
| Source witness | An exact excerpt from a named raw message field that remains under the same identity after evidence preparation. | A free-form summary or model output |
| Variation witness | Qualified reference ids and prepared message ids that mechanically prove one closed corpus variation tag. | A descriptive fixture label |
| Evaluation scorecard | One auditable report for a single exact configuration across the complete selected corpus, containing four separate production-role scorecards. | A weighted model-wide score or acceptance gate |
| Output annotation | A human-authored, exact-span and source-reference-linked classification of factual claims, attribution, event coverage, and announcement relevance. | Automatic semantic judgment |
| Qualitative review | A separate human review of coherence, usefulness, newsworthiness, and voice with rationale and uncertainty. | A numeric score or model judge |
| Scorecard context identity | The exact corpus, provenance, role configuration, ordered requests, and observed execution context to which one role's measurements belong. | Model identity alone |
| Wilson score interval | The declared 95% interval attached to one observed counted rate and its denominator. | A longitudinal drift classification or production threshold |

## Bounded Contexts

| Context | Scope | Vocabulary notes |
|---|---|---|
| Production generation | Creation and publication of one edition through four production model steps, with diagnostics retained separately from the edition. | Model-output contract or infrastructure failure is terminal; every schema-valid editorial finding is diagnostic and publication continues. |
| Model evaluation | Durable observation of real model behavior across declared benchmark runs and trials. | Parse rejection, contract rejection, and infrastructure incompletion are subject outcomes; lost invocation or runtime evidence is a harness failure. |
| Acceptance verification | Recorded replay and explicit policies that accept or reject evidence. | It consumes evidence; it does not create a quality verdict. |
| Composed product verification | The canonical local skeleton walk through deployable entrypoints. | Walking proves composition, not model quality. |
| Deterministic testing | Isolated assertions over contracts, lifecycle, persistence, and comparison logic. | Tests do not substitute for a live evaluation or walk. |
| Evaluation source evidence | Strict selection, preparation, linkage, and browsing of the synthetic reference corpus. | It owns source truth and variation coverage, never generated prose, a score, or a verdict. |
| Evaluation measurement | Strict construction and browsing of role-specific scorecards from complete retained runs, corpus sources, output annotations, and qualitative reviews. | It calculates transparent quantities and retains human judgments; it does not rank models or decide acceptance. |

## Aggregates

| Aggregate | What it is (one line) |
|---|---|
| Generation Run | Production work that creates one edition for an active region and publication date. |
| Benchmark Run | The lifecycle, invocation history, and complete runtime-evidence roster for one declared model experiment. |
| Evaluation Trial | One configuration's two-track behavior and terminal subject outcome within a benchmark. |
| Step Invocation | Immutable request, response or transport outcome, timing, findings, and retry linkage for one model call. |
| Evaluation Reference Corpus | Ordered manifest, byte-bound synthetic fixtures, exact source-witness references, and objective variation witnesses. |
| Evaluation Scorecard | Exact embedded source payloads plus four role-specific contexts, sample counts, rates, distributions, and qualitative evidence summaries. |

## Notes

The binding product vocabulary remains in `docs/DOMAIN.md`; this model adds the operational language needed by the current WSD session and must stay aligned as binding docs are amended.

## Related documentation

- [Binding domain model](../DOMAIN.md) — authoritative production vocabulary and identity rules.
- [Current shape](2026-08-10-longitudinal-model-evaluation-scorecards.shape.md) — session boundary for auditable longitudinal per-role evaluation.
- [Capability map](2026-08-10-longitudinal-model-evaluation-scorecards.map.md) — risk-ordered delivery sequence for retained evidence, corpus truth, scorecards, and longitudinal classification.
