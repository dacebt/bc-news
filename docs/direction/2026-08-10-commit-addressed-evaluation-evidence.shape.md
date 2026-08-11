---
type: shape
title: >-
  Shape: commit-addressed evaluation evidence
description: >-
  Replacement boundary for audit-by-commit scorecards whose freshness is reported without blocking evaluation.
tags: [wsd, direction, shape, evaluation, scorecards, provenance]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-11T02:09:41Z"
---
# Shape: commit-addressed evaluation evidence

**Declared:** 2026-08-10
**Cadence:** Normal
**Git strategy:** commit the coherent replacement directly to local `main`; no push, deployment, release, production access, or model inference

## In scope

- Replace scorecard and longitudinal artifacts that copy Base64 source payloads and recursively hash enclosing files with references to a Git commit and contained repository-relative path.
- Replace the current corpus manifest/reference byte links with a version-2 semantic path-and-ID contract; retain its grounding, relationship, ordering, and coverage checks.
- Resolve referenced evidence from its recorded commit when an evaluator opens or verifies an artifact, so later source edits do not alter historical meaning or require artifact regeneration.
- Report whether an evaluation's recorded code commit is current or outdated relative to the checkout. A different checkout commit is information only: it never rejects, blocks, or prevents another evaluation.
- Preserve all semantic checks that make a scorecard meaningful: strict contracts, complete source rosters, corpus/run/reference/review relationships, experimental-context comparison, units, denominators, uncertainty, and four separate role histories.
- Introduce current artifact versions for the new reference contract while keeping historical version meanings explicit, and remove the 29 MB recursively embedded controlled artifact from current verification.
- Make Codex the declared evaluator for current annotation and qualitative-review evidence without rewriting historical version-1 evidence.
- Update the binding architecture, testing, model vocabulary, direct verifiers, and focused tests to describe and exercise the replacement honestly.

## Out of scope (deliberately)

- Running models, selecting a production model, changing prompts, sampling, retries, publication, deployment, or production behavior.
- Turning freshness, model quality, scorecard measurements, or longitudinal classifications into an acceptance or release decision.
- Rewriting historical version-1 scorecard or longitudinal files in place.
- Adding external artifact storage, a database, remote Git access, signatures, weighted rankings, or an evaluator-model topology beyond the declared Codex-authored review evidence.
- Mixing the separate uncommitted evaluation-capture investigation into this change.

## Known risks

- Resolving a reference through the working tree would silently change historical evidence; reads must use the recorded commit object.
- Treating a different current checkout commit as an error would recreate the rejected fragility under another name; freshness must remain non-blocking.
- Retaining old byte-owning fields in the current contract would preserve the recursive regeneration problem even if Base64 were renamed or moved.
- Reference paths must be repository-relative and contained so a committed artifact cannot reach outside its repository.

## Success signal

The corpus, scorecard, and longitudinal commands build, store, reopen, and render current evidence that uses commit-and-path references but no embedded source payloads or cross-file byte hashes; reopening resolves the recorded evidence commits, compares each evaluated code commit with HEAD, reports outdated results without failing, the former 29 MB controlled artifact is absent, focused and full eval verification pass, and the independent composed walk still ends in `WALK PASS`.

## Notes

Git history is the immutable audit boundary. The artifact says what repository state was evaluated; it does not claim that state is still current. Existing content identities inside Benchmark Runs and metric context projections remain valid domain evidence where they identify requests, contracts, fixtures, parsed outputs, or runtime observations. They are not a substitute for copying whole child artifacts into their parents.

## Related documentation

- [Prior longitudinal shape](2026-08-10-longitudinal-model-evaluation-scorecards.shape.md) — superseded session boundary whose delivered capability is being repaired.
- [Longitudinal capability map](2026-08-10-longitudinal-model-evaluation-scorecards.map.md) — original actor-visible carve retained as historical context.
- [Evaluation and verification model](bc-news.model.md) — vocabulary to update with commit-addressed evidence and non-blocking freshness.
- [Binding testing posture](../TESTING.md) — verification-domain authority.
- [Binding architecture](../ARCHITECTURE.md) — strict-boundary authority.
