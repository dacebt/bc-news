---
type: doc
title: >-
  bc-news test and verification posture
description: >-
  The binding evidence discipline for bc-news v2 — what proves a change works, in which tier, what isolated tests defend and never defend, and how the eval harness fits as the editorial-quality tier.
tags: [documentation, testing, verification, evaluation]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-03T03:50:18Z"
authority: binding
---

# bc-news test and verification posture

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. Build
agents in this repo operate under the WSD standards discipline; this document
binds how that discipline's evidence hierarchy applies to *this* project, so
"write a test" means one thing across every session.

## Evidence tiers, strongest first

1. **The skeleton walk.** A fixed local conversation runs the whole pipeline
   — evidence in, edition generated, strict fully judged recorded eval replay,
   and the published/unavailable/Back reader experience in installed Chrome —
   with no production data or external origin. The eval candidate lives only
   in walk-owned temporary storage and must exactly match the pinned strict
   baseline apart from run identity, timestamps, and code-version provenance.
   Browser traffic is same-origin-only and exactly two pair-addressed edition
   404s are allowed. This is the [PRD](PRD.md)'s first success signal and the
   primary proof for any generation, contract, eval, or client change. A
   passing test suite over a pipeline that cannot complete this walk proves
   nothing.
2. **The eval harness.** This project's distinctive tier: repo-owned
   representative conversation fixtures replayed deterministically through
   the [evidence input port](ARCHITECTURE.md), producing comparable outputs
   with retained evidence. Prompt, model, and orchestration changes are
   judged here — same inputs, compared outputs — never by vibes on live
   data. Local models, recorded responses, and free tiers are preferred for
   routine runs; no recurring paid evaluation services.
3. **Static guarantees.** Strict TypeScript, lint, and zod contracts that
   parse-and-reject at every boundary (see the
   [structural discipline](ARCHITECTURE.md)). These catch classes of defect
   by construction; they do not prove runtime behavior.
4. **Isolated tests.** A proof surface for specific risks — never the
   default output of work, never coverage for its own sake.

## What isolated tests defend here

Write one only when it earns its place:

- **Domain invariants** — the identity rules in the
  [domain model](DOMAIN.md): one region + date → one edition, no duplicate
  publication on retry, isolation of regional failure.
- **Date and window arithmetic** — publication-date and evidence-window
  logic; v1's calendar-date rejection lessons carry forward.
- **State transitions in the generation run** — resume-after-failure
  branching, durable-step semantics, anything where a wrong branch spends
  model money or duplicates an edition.
- **Reproduced bugs** — any failure observed in the running system gets a
  regression test when it is fixed.
- **Acceptance classification** — exact eval-field drift and browser
  request/response/error classification, where one permissive branch could
  certify a different product or an external call.

Never written: tests restating what the type system or a zod schema already
proves, tests of glue and framework wiring, tests to satisfy coverage.

## Rules

- Test names state the behavior under test, nothing else: `rejects rolled
  calendar date`, not "should correctly handle invalid dates".
- Fixtures are committed, deterministic, and shared between the eval
  harness and tests — one evidence corpus, not parallel ones.
- No live network or paid model calls inside tests; recorded responses or
  local models only.
- Canonical eval comparison parses both candidate and baseline with the strict
  run schema and pins the baseline path, run id, and byte SHA-256. The
  permissive historical loader and human comparison report are not acceptance
  gates.
- Completion claims cite the tier that proved them. "Done" without evidence
  from tier 1–3 is not done.

## Links

- [Product requirements](PRD.md) — binds evaluation-led development and the
  skeleton-walk success signal.
- [Structural discipline](ARCHITECTURE.md) — the ports and boundary rules
  the tiers exercise.
- [Domain model](DOMAIN.md) — the invariants tier-4 tests defend.
