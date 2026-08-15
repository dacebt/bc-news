---
type: capability-map
title: >-
  Capability map: BCN-008 production security boundaries
description: >-
  Risk-ordered vertical capabilities and frozen boundary conventions for production HTTP, browser, data, and deployment security.
tags: [wsd, direction, capability-map, security, cloudflare, deployment]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-14T13:07:09Z"
---
# Capability map: BCN-008 production security boundaries

**Declared:** 2026-08-14
**Domain model:** [bc-news evaluation and verification](bc-news.model.md), with reader and operator vocabulary owned by the [binding domain model](../DOMAIN.md)

## New conventions

- `Authorization: Bearer` backed by the Worker secret `OPERATOR_API_TOKEN` is the single application-owned authentication seam for generation launch and operator status; edge Access may add defense later but is not required for application correctness.
- Pair-addressed status is the only supported operator read contract. Raw Workflow-ID status is not an application surface.
- Dynamic routes are public only when explicitly allowlisted. Operator responses are non-cacheable, while published-edition caching remains explicit and public.
- Generation and ingest Wrangler configuration explicitly disables `workers.dev` and preview URLs rather than relying on versioned defaults.

## Capabilities

1. **An unauthorized caller cannot launch or inspect generation work, while an authorized operator can launch and inspect the deliberate pair-addressed status contract.** — This is the highest-risk boundary because it protects Workflow execution, hosted-inference cost, and operational detail before every later production control depends on it.
2. **A reader can still load the newspaper and published edition publicly while malformed or abusive traffic meets explicit browser, cache, rate, and request boundaries.** — This preserves the public product after the operator split and proves the security posture on the same-origin path readers use.
3. **An operator can verify that the checked-in configuration has no alternate public Worker origin, no stored credential, no unintended data route, and only binding-scoped D1 access.** — Repository-side exposure, secret, dependency, and D1 evidence complete the application-security boundary without adding infrastructure or unrelated operations work.

## Order rationale

The composed acceptance spine is already green in the isolated worktree. The operator control plane comes first because it guards side effects and cost; the reader boundary then proves the public product survives that split; repository exposure and data-boundary assurance consume both contracts.

## Notes

Dependency audit work supports all three capabilities and remains a gate rather than a separate construction-phase entry.

## Related documentation

- [Current production security shape](2026-08-14-production-security-boundaries.shape.md) — cadence, worktree, session scope, and local success signal.
- [Binding domain model](../DOMAIN.md) — reader, operator, edition, and generation-run vocabulary.
- [Binding architecture](../ARCHITECTURE.md) — Worker, Workflow, D1, and same-origin client authority.
- [Binding testing posture](../TESTING.md) — composed walk and focused-test authority.
