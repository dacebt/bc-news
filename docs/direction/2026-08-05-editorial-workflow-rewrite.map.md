---
type: capability-map
title: >-
  Capability map: two-track editorial workflow
description: >-
  Risk-ordered vertical capabilities and stable conventions for the writer-to-copyedit generator, local context measurement, recording, and evaluation workflow.
tags: [wsd, direction, capability-map, generation, evaluation]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-18T15:13:37Z"
---
# Capability map: two-track editorial workflow

**Declared:** 2026-08-05
**Domain model:** [binding domain vocabulary](../DOMAIN.md)

## New conventions

- Editorial products and production steps are separate concepts: products are `main_story` and `announcements`; step ids are `main_story_write`, `main_story_copyedit`, `announcements_write`, and `announcements_copyedit`.
- A copyeditor consumes its track's draft and house rules, never the source transcript, and may improve language and formatting without changing facts, quotes, coverage, structure, or meaning.
- The main-story track owns edition title, subtitle, and story; the announcements track owns announcements; code alone assembles identity, provenance, and the final edition.
- Context measurements are model-and-request specific and report fixed prompt, evidence or draft, structured-output/template, completion, and total budgets separately for each track.

## Capabilities

1. **A local generation run publishes and renders one edition through two writer-to-copyedit tracks.** — Walking skeleton replacing the coupled three-capability roster across the composed product.
2. **A developer measures exact context budgets for each editorial track at representative message loads.** — Establishes evidence for later filter, retrieval, prompt, and model decisions without choosing them.
3. **A developer atomically records and replays the four production responses, then compares final editorial products.** — Replaces the six-response packaging/judge topology after the production seam is walking.

## Order rationale

The four-step composed run is the architectural risk and must walk first. Measurement follows before any live re-record or evidence tuning; recording and eval then bind to the proven production topology rather than designing it indirectly.

## Notes

Tool-calling research agents and iterative critic loops remain possible future capabilities, not hidden extensions of the copyedit step.

## Related documentation

- [Paired historical rewrite shape](2026-08-05-editorial-workflow-rewrite.shape.md) — session boundary that governed this map.
- [Product requirements](../PRD.md) — evaluation-led and replaceable-model requirements this carve serves.
- [Domain model](../DOMAIN.md) — vocabulary authority amended by the first capability.
