---
type: doc
title: >-
  bc-news structural discipline
description: >-
  The binding architecture posture for bc-news v2 — TypeScript throughout, exactly two ports (model provider, evidence input), functional core with zod-validated rejecting boundaries, and deliberate Cloudflare coupling everywhere else.
tags: [documentation, architecture, ports, typescript]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-03T01:35:00Z"
authority: binding
---

# bc-news structural discipline

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. It
binds the structural posture; the *why* is recorded in the project decision
vault (ADR-001, ADR-002).

## Language

The repository is **TypeScript throughout** — workers, the Workflow, the
eval harness, the client, and shared contract packages. No second language
enters the repo; v1 already paid once to unwind a split stack (see the
[v1 reference map](v1-reference.md)).

## Posture: selective ports, not hexagonal

Full ports-and-adapters is rejected. The
[product requirements](PRD.md) accept Cloudflare lock-in, so the platform
is **not** abstracted: no repository pattern over D1, no wrapper over
Queues or the Workflow runtime, no dependency-injection framework.
Exactly two ports exist, because the PRD demands substitution at exactly
these seams:

1. **Model provider port** — each *editorial capability* (see the
   [domain model](DOMAIN.md)) calls models through one interface; hosted
   and local providers are adapters behind it. Changing a capability's
   model touches configuration, never orchestration.
2. **Evidence input port** — regional chat evidence enters generation
   through a single seam, so repository fixtures and production storage
   feed the identical pipeline. This is what makes "a fixed local
   conversation produces a complete edition without production data" hold.

Adding a third port requires amending this document with the requirement
that forces it.

## Functional core, imperative shell

- Workflow steps are thin orchestration: load inputs, call pure domain
  functions, persist outputs. Editorial and preparation logic lives in
  pure functions that never touch a binding, a clock they weren't handed,
  or the network.
- **Boundaries validate and reject; they never coerce.** Every seam —
  BitJita responses, D1 reads, model outputs, configuration — parses with
  zod and fails loudly on mismatch. This is v1's hardest-won lesson,
  carried forward as law.
- Errors surface. No swallowed failures inside scheduler or workflow
  glue; v1's error-eating `scheduled()` is the named anti-pattern.
- One fact, one home: no value (region lists, date arithmetic, prompt
  text) duplicated across packages the way v1 duplicated them.

## Layout and remaining structure

Package layout follows v1's monorepo shape — pnpm workspaces with apps and
shared contract packages — modernized to this build. v1's observed behavior
is the default for product questions (see the [domain model](DOMAIN.md)).

Settled — the concrete schema at the evidence input port: the port carries
validated chat messages, `{ id, ts (UTC milliseconds), author_id,
author_name (nullable), text }`, grounded in the seam v1's generator
observably consumed. An adapter receives an active region and an *evidence
date* (see the [domain model](DOMAIN.md)) — never a publication date; the
derivation lives once in the functional core — and returns that day's
messages in the UTC window [00:00 of the evidence date, 00:00 of the next
day), end-exclusive. Adapters parse every row against the shared schema and
reject before returning; ordering is unspecified at the port, and the pure
core sorts deterministically.

What remains genuinely structural and gets settled by amendment here: the
local runner, and persistence and artifact-retention choices.

## Links

- [Product requirements](PRD.md) — the constraints this posture serves.
- [Domain model](DOMAIN.md) — the vocabulary these structures implement.
- [v1 reference map](v1-reference.md) — the prior art and the failure
  modes this discipline is designed against.
