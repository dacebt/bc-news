---
type: thickening
title: >-
  Thickening: auditable evaluation reference corpus
description: >-
  Active WSD thickening for selecting and browsing an ordered varied synthetic chat corpus with separate source-grounded reference evidence.
tags: [wsd, thickening, active]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-10T06:19:25Z"
---
# Thickening: auditable evaluation reference corpus

**Started:** 2026-08-10
**Git strategy:** commit this coherent thickening directly to local `main`; no push
**Cadence:** Normal

## Dimension

Evaluation source-evidence corpus and independently auditable reference truth.

## Observable delta

- before: an evaluator can load only one repository chat fixture at a time, and the repository has no separate contract describing what that conversation establishes.
- after: an evaluator selects and browses one ordered, deliberately varied synthetic multi-fixture corpus whose strict reference records use exact prepared-evidence-surviving excerpts to identify claims, events, ambiguities, names, numbers, and noteworthy candidates without containing novel article prose, a preferred angle, or prescribed wording.

## Minimum surface

- A versioned strict corpus manifest that owns deterministic order and links every synthetic chat fixture to exactly one separate reference record through byte identities rather than directory guessing.
- A deliberately varied committed fixture collection covering dense and sparse conversations, overlapping and isolated events, contradictory or unresolved statements, names and numeric claims, announcement candidates, and explicitly identified irrelevant chatter while remaining valid raw `EvidenceFixtureSchema` evidence and surviving the real preparation path.
- Versioned strict reference records whose status-shaped witnesses are exact excerpts from source-message fields, whose cited identities and grounding survive prepared evidence, and whose closed variation tags carry objective witnesses; dangling, duplicate, reordered, mismatched, unlisted, extra-field, or falsely grounded evidence is rejected.
- Eval-owned manifest/reference readers, fixture-level browse and summary output, and CLI routing that select the corpus explicitly while preserving every existing valid single-fixture command, artifact, and output; CLI help may name the new namespace.
- A repository-owned direct verifier plus focused schema, linkage, ordering, hashing, and rejection tests; README, architecture, testing, and evaluation-domain vocabulary updated only where this capability changes the truth.

## Verification path

`pnpm --filter @bc-news/eval verify:evaluation-reference-corpus` loads the committed manifest through the real readers, prepares every fixture through the production evidence path, browses the ordered corpus summary, proves exact source excerpts and every objective variety witness, rejects corrupted linkage, directory closure, grounding, status, relationship, and target-article-shaped extra fields, and ends exactly with `EVALUATION REFERENCE CORPUS VERIFIED`. Root separately audits the committed synthetic chat/excerpt prose for editorial instructions. The project-level typecheck, lint, test suite, and `/Users/epicbadtiming/.codex/plugins/cache/ebt-plugins/ebt-wsd/0.12.2/bin/wsd-walk --require-probe --expect "WALK PASS"` then prove the new evaluation evidence boundary did not regress the composed product.

## Residual risks

- Non-invariant: the synthetic corpus establishes controlled source truth but does not claim to reproduce the eventual frequency distribution of production chat; later locally authorized fixtures can extend the versioned corpus through the same contract.
- Non-invariant: the committed corpus increases repository and verification volume; storage or test-runtime optimization is warranted only after observed cost.
- Non-invariant: this capability exposes reference evidence but does not yet calculate per-agent measurements or accept manual qualitative reviews; those are separate actor-visible capabilities 3 and 4 on the approved map.

## Notes

Chat fixtures remain the model's only source evidence. Reference records use exact source excerpts and closed classifications rather than novel summaries; they may not supply article prose, narrative structure, editorial angle, model output, a quality score, or an acceptance verdict. Strict parsing proves the structural boundary, while root's prose audit owns the content judgment. No live inference, external dataset acquisition, or production data is part of this thickening.

## Context

- governed by the [longitudinal scorecard shape](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.shape.md)
- implements capability 2 of the [longitudinal scorecard map](../direction/2026-08-10-longitudinal-model-evaluation-scorecards.map.md)
- uses the established vocabulary in the [evaluation and verification model](../direction/bc-news.model.md)
