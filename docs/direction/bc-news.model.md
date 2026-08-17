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

**Last updated:** 2026-08-17
**Update reason:** strict aggregate evaluation results — add whitelist-only aggregate exports while keeping scorecards commit-addressed, Codex-authored, and evaluation-only.

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
| Evaluation reference corpus | The current local V3 selection-bound corpus workspace under `apps/eval/local-data/corpus-workspaces/`, plus the historical Git-addressed V2 synthetic corpus reader. | A Benchmark Run or target article |
| Semantic reference | A root-authored local reference record in a V3 corpus workspace that links selection-bound prepared evidence to claims, events, ambiguities, and variation witnesses without copying production chat into tracked files. | A model output or generated summary |
| Source witness | An exact excerpt from a named raw message field that remains under the same identity after evidence preparation. | A free-form summary or model output |
| Variation witness | Qualified reference ids and prepared message ids that mechanically prove one closed corpus variation tag. | A descriptive fixture label |
| Evaluation scorecard | One auditable report for a single exact configuration across the complete selected corpus, containing four separate production-role scorecards. Current V3 artifacts are local hash-addressed under `apps/eval/local-data/scorecards`; embedded V1 and Git-addressed V2 remain historical readers. | A weighted model-wide score or acceptance gate |
| Aggregate evaluation result | One commit-safe role summary exported from one validated scorecard with `cohort.evidence_identity_sha256` bound to the source corpus identity, retaining only the subject descriptor, counts, rates with intervals, aggregate distributions, and qualitative counts. | A scorecard, source or model-output evidence, or an acceptance verdict |
| Output annotation | A Codex-authored, exact-span and source-reference-linked classification of factual claims, attribution, event coverage, and announcement relevance. | A deterministic assertion |
| Qualitative review | A separate Codex review of coherence, usefulness, newsworthiness, and voice with rationale and uncertainty. | A numeric score or acceptance gate |
| Repository source reference | A repository name, full Git commit SHA, and contained POSIX repository-relative path that identifies one source file. | An embedded payload or child-file hash |
| Evaluation freshness | Current or outdated information from comparing an evaluated code commit with an explicitly resolved repository-root HEAD. | Artifact validity, a gate, or permission to evaluate |
| Scorecard context identity | The exact corpus source commit and path, provenance, role configuration, ordered requests, and observed execution context to which one role's measurements belong. | A scorecard evidence-storage commit or model identity alone |
| Wilson score interval | The declared 95% interval attached to one observed counted rate and its denominator. | A longitudinal drift classification or production threshold |
| Longitudinal scorecard series | One ordered durable audit pack containing an earlier baseline partition and later subject partition of exact Evaluation Scorecards. Current V3 series are local hash-addressed under `apps/eval/local-data/longitudinal-scorecards`; embedded V1 and Git-addressed V2 remain historical readers. | A list of rendered summaries without their source evidence |
| Stable cohort identity | A role-specific comparable-context identity normalized away from generated run/trial locators while retaining corpus, request, contract, code, role configuration, retry policy, and execution context. | The capability-3 scorecard context hash or model name alone |
| Baseline partition | The explicitly declared earlier scorecard audit packs used to expose ordinary observed variation; at least three pairwise-disjoint packs are required for sufficient longitudinal evidence. | A preferred model, acceptance baseline, or byte-pinned product fixture |
| Subject partition | The explicitly declared later scorecard audit packs compared with one exact baseline cohort; at least two pairwise-disjoint packs are required for sufficient longitudinal evidence. | A challenger model or production candidate |
| Longitudinal classification | One of context-changed, insufficient-evidence, within-baseline, or potential-drift for one production role. | Causality, equivalence, quality, pass/fail, or production action |
| Potential drift | A named quantitative observation whose later evidence is strictly separated from its unchanged-context baseline under the declared policy. | A regression verdict, model rank, or recommendation |

## Bounded Contexts

| Context | Scope | Vocabulary notes |
|---|---|---|
| Production generation | Creation and publication of one edition through four production model steps, with diagnostics retained separately from the edition. | Model-output contract or infrastructure failure is terminal; every schema-valid editorial finding is diagnostic and publication continues. |
| Model evaluation | Durable observation of real model behavior across declared benchmark runs and trials. | Parse rejection, contract rejection, and infrastructure incompletion are subject outcomes; lost invocation or runtime evidence is a harness failure. |
| Acceptance verification | Recorded replay and explicit policies that accept or reject evidence. | It consumes evidence; it does not create a quality verdict. |
| Composed product verification | The canonical local skeleton walk through deployable entrypoints. | Walking proves composition, not model quality. |
| Deterministic testing | Isolated assertions over contracts, lifecycle, persistence, and comparison logic. | Tests do not substitute for a live evaluation or walk. |
| Evaluation source evidence | Strict content-free selection, preparation, linkage, and browsing of the current local V3 corpus plus the historical V2 synthetic reader. | It owns source truth and variation coverage, never generated prose, a score, or a verdict. |
| Evaluation measurement | Strict construction and browsing of role-specific scorecards from complete retained runs, corpus sources, output annotations, and qualitative reviews. | It calculates transparent quantities and retains Codex judgments; it does not rank models or decide acceptance. |
| Aggregate evaluation reporting | Strict export, reopening, and comparison of content-free role aggregates projected from validated scorecards. | It is descriptive and evaluation-only; it does not rank, recommend, accept, select production, or walk. |
| Longitudinal evaluation measurement | Strict reconstruction and temporal comparison of selected scorecard audit packs inside stable role cohorts. | It classifies evidence and retains uncertainty; it does not judge quality, infer causality, or trigger product behavior. |

## Aggregates

| Aggregate | What it is (one line) |
|---|---|
| Generation Run | Production work that creates one edition for an active region and publication date. |
| Benchmark Run | The lifecycle, invocation history, and complete runtime-evidence roster for one declared model experiment. |
| Evaluation Trial | One configuration's two-track behavior and terminal subject outcome within a benchmark. |
| Step Invocation | Immutable request, response or transport outcome, timing, findings, and retry linkage for one model call. |
| Evaluation Reference Corpus | Current local V3 selection-bound snapshot copy, copied selection, derived fixtures, root-authored semantic references, and objective variation witnesses, plus the historical Git-addressed V2 synthetic reader. |
| Evaluation Scorecard | A commit-addressed declaration plus compact source descriptors, four role-specific contexts, sample counts, rates, distributions, qualitative summaries, and freshness information. |
| Aggregate Evaluation Result | A whitelist-only role summary exported from a validated scorecard with `cohort.evidence_identity_sha256` bound to its source corpus identity, with subject descriptor, counts, rates and intervals, aggregate distributions, and qualitative counts only. |
| Longitudinal Evaluation Scorecard Series | Local hash-addressed current scorecard audit packs plus four stable cohort histories, baseline/subject summaries, signal witnesses, evidence classifications, and per-scorecard freshness information; embedded V1 and Git-addressed V2 remain historical readers. |

## Notes

The binding product vocabulary remains in `docs/DOMAIN.md`; this model adds the operational language needed by the current WSD session and must stay aligned as binding docs are amended.

## Related documentation

- [Binding domain model](../DOMAIN.md) — authoritative production vocabulary and identity rules.
- [Current shape](2026-08-17-local-evaluation-evidence.shape.md) — current session boundary for private evidence replacement and safe aggregate exports.
- [Capability map](2026-08-17-local-evaluation-evidence.map.md) — risk-ordered delivery sequence for aggregate exports, local scorecards, local corpus curation, and code-only checkout use.
