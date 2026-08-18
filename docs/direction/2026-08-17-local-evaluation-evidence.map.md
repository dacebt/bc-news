---
type: capability-map
title: >-
  Capability map: local-only production evaluation evidence
description: >-
  Risk-ordered vertical capabilities and feature conventions for private local evaluation evidence and commit-safe aggregate results.
tags: [wsd, direction, capability-map, evaluation, privacy]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-18T14:54:16Z"
---
# Capability map: local-only production evaluation evidence

**Declared:** 2026-08-17
**Domain model:** [bc-news evaluation and verification](bc-news.model.md)

## New conventions

- `apps/eval/local-data/` is the single ignored root for every content-bearing evaluation input and artifact.
- Current local evidence uses contained relative paths plus SHA-256 integrity; Git commits are not its storage or resolution boundary.
- `apps/eval/summaries/` admits only strict aggregate JSON built by a whitelist; reports are rendered from that JSON rather than committed as prose.
- Production corpus extraction is driven only by region and half-open UTC windows; content, author, keyword, and message-ID selectors are forbidden.

## Capabilities

1. **An evaluator exports and compares a strict aggregate scorecard without private evidence** — establishes the highest-risk commit boundary before production-derived data enters the workflow.
2. **An evaluator builds and reopens full scorecard and longitudinal evidence entirely from a private local workspace** — replaces the Git-addressed evidence dependency the remaining workflow relies on.
3. **An evaluator materializes and validates the six exact production-grounded cases from the snapshot** — exercises the local boundary with the real corpus while keeping all content ignored.
4. **A contributor clones a code-only evaluation harness with no historical corpus or audit packs in the current tree** — completes the replacement after the new workflow is observable.

## Order rationale

The composed product already has a healthy recorded-replay walk. Privacy export risk comes first, local evidence resolution enables real corpus use, and destructive historical cleanup waits until the replacement path is proven.

## Notes

The full 13-region day remains a later finalist stress corpus. The current six-case comparison uses one repetition and four production calls per case.

## Related documentation

- [Current shape](2026-08-17-local-evaluation-evidence.shape.md) — cadence, boundaries, and success signal.
- [Evaluation and verification model](bc-news.model.md) — shared vocabulary.
- [Binding testing posture](../TESTING.md) — acceptance and model-evaluation separation.
