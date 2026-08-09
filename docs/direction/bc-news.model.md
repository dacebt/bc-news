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
  at: "2026-08-06T18:45:48Z"
---
# Domain Model: bc-news evaluation and verification

**Last updated:** 2026-08-09
**Update reason:** schema-valid editorial completion — separate terminal model-output contracts from retained non-terminal diagnostics.

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

## Bounded Contexts

| Context | Scope | Vocabulary notes |
|---|---|---|
| Production generation | Creation and publication of one edition through four production model steps, with diagnostics retained separately from the edition. | Model-output contract or infrastructure failure is terminal; every schema-valid editorial finding is diagnostic and publication continues. |
| Model evaluation | Durable observation of real model behavior across declared benchmark runs and trials. | Parse rejection, contract rejection, and infrastructure incompletion are subject outcomes; lost evidence is a harness failure. |
| Acceptance verification | Recorded replay and explicit policies that accept or reject evidence. | It consumes evidence; it does not create a quality verdict. |
| Composed product verification | The canonical local skeleton walk through deployable entrypoints. | Walking proves composition, not model quality. |
| Deterministic testing | Isolated assertions over contracts, lifecycle, persistence, and comparison logic. | Tests do not substitute for a live evaluation or walk. |

## Aggregates

| Aggregate | What it is (one line) |
|---|---|
| Generation Run | Production work that creates one edition for an active region and publication date. |
| Benchmark Run | The lifecycle and complete evidence roster for one declared model experiment. |
| Evaluation Trial | One configuration's two-track behavior and terminal subject outcome within a benchmark. |
| Step Invocation | Immutable request, response or transport outcome, timing, findings, and retry linkage for one model call. |

## Notes

The binding product vocabulary remains in `docs/DOMAIN.md`; this model adds the operational language needed by the current WSD session and must stay aligned as binding docs are amended.

## Related documentation

- [Binding domain model](../DOMAIN.md) — authoritative production vocabulary and identity rules.
- [Current shape](2026-08-06-real-model-evaluation-harness.shape.md) — session boundary that introduced this operational model.
