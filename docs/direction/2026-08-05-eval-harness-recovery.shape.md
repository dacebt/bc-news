---
type: shape
title: >-
  Shape: eval harness and recorded-provenance recovery
description: >-
  Session boundaries, cadence, and success signal for recovering the valid harness redesign from an unapproved and internally contradictory dirty tree.
tags: [wsd, direction, shape, evaluation, recovery]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-06T01:22:13Z"
---
# Shape: eval harness and recorded-provenance recovery

**Declared:** 2026-08-05
**Cadence:** Loose
**Git strategy:** commit-to-main — this session is the only writer; optional parallel hands may use in-repo worktrees, but accepted work lands serially on local `main`

## In scope

- Recover the valid ADR-013 implementation: twice-run recorded determinism, recomputed semantic and grounding relations, all-path difference reporting, and provenance that remains inspectable without becoming an acceptance pin.
- Remove the contradictory committed-manifest design and every gate over pinned fixture bytes, prepared-evidence bytes, prompt hashes, response bytes, or whole-run baseline bytes.
- Remove the unapproved judge thresholds without inventing replacements, and amend ADR-013 plus binding repository documentation to state the resulting accepted posture truthfully.
- Preserve the safe complete-tree re-record path: three capability responses and three judge verdicts recorded together, validated before one atomic promotion, with the judge adapter kept outside the Worker's three-capability `MODEL_CONFIG`.
- Restore the accepted LM Studio sampling values, then use only the already-loaded local Qwen model for one six-response re-record so every committed prompt stamp is producer-written provenance again.
- Retain warranted default-pipeline property tests while removing superseded pin-verification machinery.

## Out of scope (deliberately)

- Selecting or introducing any judge quality threshold.
- Changing prompts, editorial roles, edition behavior, evidence preparation, model assignments, or Qwen sampling beyond restoring the previously accepted values.
- Loading, switching to, benchmarking, or invoking any other local model; hosted, paid, network, or production model calls.
- Production Cloudflare work, deployment, release, migration, or changes to the frozen predecessor.
- Unrelated cleanup or refactoring outside the dirty eval, fixtures, and re-recording surface.

## Known risks

- Valid and invalid edits overlap in the same files, so broad reversion could discard the twice-run, grounding, property-test, or atomic-recording work that must survive.
- The current green walk includes the contradictory manifest gate; acceptance must prove the composed path again after that mechanism is absent.
- Direct-to-main recovery starts from a large uncommitted tree; every accepted edit must be reviewed against `11de9ff`, and optional parallel work must merge serially before commit.

## Success signal

Using only the loaded local Qwen model, the recorder atomically replaces all six responses with producer-written prompt provenance; then `pnpm walk -- --non-interactive` prints `WALK PASS` while canonical acceptance proves twice-run determinism and recomputed relations with no manifest, baseline-byte, or unapproved-threshold gate.

## Notes

This is one bounded recovery capability, so no new capability map or domain model is warranted. Local Qwen use is authorized only for this re-record; all other model contexts remain untouched.

## Related documentation

- [Prior full-rebuild shape](2026-08-04-v2-full-rebuild.shape.md) — superseded session boundary retained as history.
- [Capability map](2026-08-04-v2-full-rebuild.map.md) — completed rebuild carve whose established conventions this recovery preserves.
- [Structural discipline](../ARCHITECTURE.md) — binding architecture to reconcile with the recovered implementation.
- [Test and verification posture](../TESTING.md) — binding evidence contract to reconcile with ADR-013.
