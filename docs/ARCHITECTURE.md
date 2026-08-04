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
vault (ADR-001, ADR-002, ADR-005, ADR-006, ADR-007, ADR-008).

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

Settled — persistence for the completed edition: one D1 database with a
single `edition` table, primary key `(active_region_id, publication_date)`.
Publish is one atomic `INSERT ... ON CONFLICT DO NOTHING` — the first
published edition wins and is immutable under duplicate invocation. Reads
serve only by the identity pair and validate `document_json` against the
same required-`meta` edition schema used at publish; a stored row that
fails that parse is a distinct `edition_unreadable` failure, never
masqueraded as absence. Workflow step results are the durable inter-step
handoff (bounded by the platform's step-result cap and asserted, never
truncated); no separate artifact store exists, and Workflow instance state
is never the edition's durable home (ADR-005).

Settled — edition identity enforcement, three layers with the SQL layer
authoritative: (1) the trigger derives a deterministic Workflow instance
id from the pair, so duplicate delivery targets one instance rather than
starting a second *generation run* — observed local-emulation behavior of
a duplicate id is recorded in ADR-006, and this layer is deliberately not
load-bearing; (2) the D1 pair primary key plus insert-if-absent publish is
the authoritative guarantee that a second edition row cannot exist; (3)
clients address editions only by the pair, so exactly one edition is ever
addressable per identity. v1's lease/fencing/run-version apparatus is
deliberately not carried: it compensated for competing stateless cron
ticks, which one Workflow instance per pair eliminates.

Settled — serving topology (ADR-007): the client is a Vite-built SPA whose
`dist/` mounts as Workers static assets on the single generation Worker.
One origin serves reader and API traffic, so the client's `/api/edition`
read is same-origin with no CORS surface, and one `wrangler dev` session
serves the whole product — dev topology equals production topology. Routing
is asset-first: a request matching a built asset is served without invoking
Worker code; every other request reaches the Worker's routes, so an unknown
path is the Worker's explicit 404, never a silent asset fallback. No Pages
project and no second Worker exist. The client validates at its boundary
like every other seam: `/api/edition` responses parse with the shared
edition schema and the identity pair arrives only via URL query — missing
or invalid identity renders the explicit no-published-edition state, never
a fixture default baked into client code.

Settled — the local runner (ADR-008): `pnpm walk` runs a TypeScript walk
script over `wrangler dev`, the only local path that executes the real
Workflow definition — local emulation covers the Workflow, D1, and static
assets in one session, and Workflows do not run under `--remote`, so the
runner is local-only by construction; no mock of Cloudflare exists
anywhere. The walk builds the workspace, applies the D1 migrations into a
per-run isolated local persistence directory (every walk starts from
absence, so the first trigger is genuinely the first), starts
`wrangler dev`, triggers one *generation run* for the fixture pair, polls
the edition read until it serves and parses the body against the shared
edition schema, re-triggers the same pair asserting the served edition is
byte-identical while recording the duplicate-create signal (ADR-006),
asserts an unknown pair answers 404, and asserts the client HTML serves.
On timeout it prints the generation run's status — failures surface,
never vanish — and the exit code reflects the assertions. The default
mode holds `wrangler dev` for human browser observation until Ctrl-C; a
non-interactive mode (`--non-interactive` or `WALK_NON_INTERACTIVE=1`)
shuts down after the assertions for automation. The walk touches no
production data, no live network, and no paid models by construction:
fixture evidence and the recorded model provider are its only inputs.

## Links

- [Product requirements](PRD.md) — the constraints this posture serves.
- [Domain model](DOMAIN.md) — the vocabulary these structures implement.
- [v1 reference map](v1-reference.md) — the prior art and the failure
  modes this discipline is designed against.
