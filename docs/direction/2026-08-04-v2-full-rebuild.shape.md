---
type: shape
title: >-
  Shape: v2 full rebuild — skeleton to finished product, pre-deployment
description: >-
  Session boundaries, cadence, and success signal for growing the walking skeleton into the complete bc-news v2 product, stopping deliberately before production Cloudflare deployment.
tags: [wsd, direction, shape]
status: deprecated
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-06T00:29:41Z"
---
# Shape: v2 full rebuild — skeleton to finished product, pre-deployment

**Declared:** 2026-08-04
**Cadence:** Loose
**Git strategy:** other — wsd-flow slice branches in per-slice worktrees; the orchestrator verifies (walk + review) and merge-gates every slice onto main; no PRs; main only ever receives accepted, walked work

## In scope

- Skeleton follow-ups from the review pass (markdown-security dedup, evidence tie-break, evidence-window enforcement in core, nullable author_name coverage).
- The full three-stage editorial roster (announcements/achievements, main story, packaging) with v1's prompts carried near-verbatim; edition contract and client thicken accordingly.
- Real model-provider adapters: config-dispatched port lookup for recorded replay, OpenAI-compatible local inference (LM Studio), and generic OpenAI-compatible hosted inference in both generation and evaluation; recorded adapters remain the automated default.
- Ingest app: v1's proven engine carried forward into this monorepo (cursor, watermark, boundary rejection), storing validated chat in D1 and feeding generation through a production evidence adapter behind the same evidence port.
- Scheduling: cron-driven end to end locally — one authoritative active-region home, one Workflow instance per (active region, publication date), operator-visible run status.
- Client full UI/UX parity with deployed bc-newspaper v0.1.x (history/navigation, unavailable states, code-splitting) minus contract-forced deviations.
- Eval harness: fixture conversations replayed through the evidence port, comparable retained results, judge rubrics carried from v1.

## Out of scope (deliberately)

- Production Cloudflare setup of any kind — provisioning, deploys, secrets, real database_id. User-led, after this session.
- Every live model call in this run, including LM Studio and hosted inference, plus live BitJita network calls and paid model calls. Model-provider behavior is proven with recorded responses and repository-owned loopback servers only.
- Migrating v1 data or modifying the frozen v1 repos.
- Paid evaluation services or any recurring paid infrastructure.

## Known risks

- Live LM Studio and hosted endpoints are intentionally unobserved in this run; strict protocol, retry, usage, cost, and credential-containment behavior is proven against the repository-owned loopback server, while actual vendor availability and credential validity remain deployment-time observations.
- Local emulation gaps (cron triggers, duplicate Workflow instance-id no-op per ADR-006) may make some production behavior observable only at deployment; those obligations are named, not silently absorbed.
- Many parallel slices touch the shared contracts package; the edition-contract seam must be frozen early and owned by one slice at a time or reconciled at merge.

## Success signal

`pnpm walk` (extended as slices land) passes tier-1 for the full product: fixture chat ingested into local D1 by the ingest worker, a cron-style trigger fans out per active region, the generation run produces a three-capability edition (announcements populated, main story, packaged), the client renders it at v1 parity, and the eval harness replays the same fixtures producing retained comparable results — all local, no production data, no paid calls.

## Notes

Rulings in force: Claude never touches production Cloudflare; slice branches invited under wsd-flow with orchestrator merge-gate; build direction and parallelization are the orchestrator's call; LM Studio URL supplied by the user on request. DOMAIN.md names may be adjusted deliberately (amend in the same unit of work).

## Related documentation

- [Capability map](2026-08-04-v2-full-rebuild.map.md) — the carve of this scope into ordered vertical capabilities.
- [Binding product requirements](../PRD.md) — the authority this shape serves.
- [Documentation index](../index.md) — bundle root.
