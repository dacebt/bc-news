---
type: shape
title: >-
  Shape: editorial generation ownership
description: >-
  Tight-cadence session boundary for two final editorial writers, proportionate in-world storytelling, and deterministic edition assembly.
tags: [wsd, direction, shape, generation, prompts]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-30T14:37:52Z"
---
# Shape: editorial generation ownership

**Declared:** 2026-08-19
**Cadence:** Tight
**Git strategy:** commit-to-main

## In scope

- Make the main-story and announcement writers the only production model steps and have each file publication-ready structured copy.
- Instruct the main-story writer to turn even ordinary player interactions into proportionately sized in-world BitCraft reporting while keeping invented concrete facts out of asserted reporting.
- Retain structured headline, lede, and body output; remove model-authored or dead fields that do not earn their place and normalize presentation strings deterministically.
- Treat evidence that becomes empty after preparation hygiene as the existing no-evidence failure and do not invoke either writer. With prepared evidence, the editorial contract has no abstention or no-story state; transport failures and malformed or schema-invalid model output remain explicit operational failures.
- Update current generation, configuration, fixtures, evaluation, walking-skeleton, and binding-document contracts while keeping retained historical evaluation evidence readable.
- Give newly assembled editions and new generation-run status projections explicit current contract-version discriminators; untagged stored records remain legacy-only so partial historical data cannot look current.

## Out of scope (deliberately)

- Per-message or chunked extraction pipelines, additional editorial model roles, model selection, or a reader-interface redesign.
- Hosted inference, production access, deployment, push, public publication, or migration of ignored local evaluation evidence.

## Known risks

- Current evaluation contracts assume four ordered model roles; changing the active topology without an explicit historical-reader boundary would invalidate retained evidence.
- String normalization could alter intended prose if it crosses from representation cleanup into semantic rewriting.
- Prompt wording must preserve imaginative in-world voice without presenting invented quantities, locations, outcomes, or consequences as established facts.
- Raw chat may collapse to zero prepared messages after hygiene; the workflow must reject that boundary before either model call.
- Omission-only current/legacy unions could accept truncated historical editions or partially completed old statuses as current unless new records carry explicit discriminators.

## Success signal

The composed local walk publishes and serves a schema-valid edition from exactly two recorded writer calls, and representative model evaluation shows an ordinary player exchange becoming a proportionate structured story.

## Notes

The user reviews the runtime prompt wording before the thickening is accepted. Tight cadence applies to this single composed thickening, not to its internal file edits.

## Related documentation

- [Binding domain model](../DOMAIN.md) — authoritative editorial-product and production-step vocabulary to amend with the implementation.
- [Operational domain model](bc-news.model.md) — evaluation vocabulary that must remain compatible with historical four-step evidence.
- [Prior editorial workflow shape](2026-08-05-editorial-workflow-rewrite.shape.md) — established the writer-to-copyedit topology this session replaces.
- [Direction index](index.md) — current and historical WSD session boundaries.
