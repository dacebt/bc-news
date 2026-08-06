---
type: shape
title: >-
  Shape: two-track editorial workflow rewrite
description: >-
  Session boundaries, cadence, and success signal for replacing the inherited three-stage generator and judge-centered eval with two writer-to-copyedit tracks and measured local-model context budgets.
tags: [wsd, direction, shape, generation, evaluation]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-06T01:22:13Z"
---
# Shape: two-track editorial workflow rewrite

**Declared:** 2026-08-05
**Cadence:** Loose
**Git strategy:** commit-to-main — one accepted thickening at a time; file-disjoint build hands may work in parallel

## In scope

- Replace the production roster with `main_story_write → main_story_copyedit` and `announcements_write → announcements_copyedit`, then assemble the edition deterministically with no packaging model.
- Let the main-story track author title, subtitle, and story content; let the announcements track author announcements; make each copyeditor narrow and preservation-bound rather than an editorial judge.
- Carry the new four-step topology through prompts, strict contracts, model configuration, structured output, durable Workflow/status state, edition provenance, migrations, recorded fixtures, the local walk, and binding documentation.
- Rebuild recording and eval around the four production calls and final outputs; remove automatic LLM judge rounds, quality floors, byte pins, and obsolete packaging/judge fixtures.
- Add per-track, representative-load context benchmarks that measure the exact configured tokenizer/request budget before any evidence-selection change.
- Treat undeployed v2 state as replaceable: amend migration sources and reset only local v2 databases or retained artifacts when required by the new contracts.

## Out of scope (deliberately)

- Final prompt tuning, prose-quality optimization, model bake-offs, or production model/fallback selection.
- Evidence filtering, sampling, retrieval, chunking, or tool-calling editorial agents before context and coverage benchmarks justify a design.
- Critic/revision loops beyond the one narrow copyedit pass per editorial track.
- Production data, production Cloudflare resources, deployment, release, or changes to the frozen v1 repositories.

## Known risks

- The old three-capability id is coupled across contracts, Workflow state, D1 constraints, fixtures, eval, and documentation; partial replacement would leave a falsely green path.
- Copyediting can silently change facts or coverage unless its allowed transformation boundary is explicit and observed end to end.
- The working tree contains an abandoned recovery implementation; reusable guard and atomic-recording work must be separated from topology-specific six-call assumptions.

## Success signal

`pnpm walk -- --non-interactive` prints `WALK PASS` after a fresh local run produces and renders one edition through exactly four recorded production steps—two writers and their preservation-bound copyeditors—with deterministic assembly, truthful usage/status, no packaging or judge model call, and a context benchmark reports exact budgets for both tracks across representative message loads.

## Notes

Change is expected before deployment. Compatibility with undeployed v2 local state is not an invariant; truthful replacement and a runnable composed workflow are.

## Related documentation

- [Editorial workflow capability map](2026-08-05-editorial-workflow-rewrite.map.md) — risk-ordered verticals for this rewrite.
- [Product requirements](../PRD.md) — permits editorial-role and autonomy redesign during build planning.
- [Domain model](../DOMAIN.md) — binding vocabulary to amend as the new roster lands.
