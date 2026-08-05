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
  at: "2026-08-04T18:01:01Z"
authority: binding
---

# bc-news structural discipline

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. It
binds the structural posture; the *why* is recorded in the project decision
vault (ADR-001, ADR-002, ADR-005, ADR-006, ADR-007, ADR-008, ADR-009).

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
  text) duplicated across packages the way v1 duplicated them. Settled —
  the active region list's authoritative home is
  `packages/contracts/src/active-regions.ts` (the [domain model](DOMAIN.md)'s
  open structural decision), consumed by the scheduler and the client alike.

## Layout and remaining structure

Package layout follows v1's monorepo shape — pnpm workspaces with apps and
shared contract packages — modernized to this build. v1's observed behavior
is the default for product questions (see the [domain model](DOMAIN.md)).

Settled — the concrete schema at the evidence input port (ADR-009): the
port carries validated chat messages, `{ id, ts (UTC milliseconds), author_id,
author_name (nullable), text }`, grounded in the seam v1's generator
observably consumed. An adapter receives an active region and an *evidence
date* (see the [domain model](DOMAIN.md)) — never a publication date; the
derivation lives once in the functional core — and returns that day's
messages in the UTC window [00:00 of the evidence date, 00:00 of the next
day), end-exclusive. Adapters parse every row against the shared schema and
reject before returning; ordering is unspecified at the port, and the pure
core sorts deterministically.

Settled — one D1 database, four tables, one migration owner: alongside
`edition` (publish target, primary key `(active_region_id,
publication_date)`), the same database now holds `chat_messages` and
`poll_state` — the ingest Worker's durable chat storage and cursor
watermark — plus `generation_run_status`, the operator projection keyed by
the same active-region/publication-date pair. The migration chain lives solely
in `apps/generation/migrations`;
the ingest Worker binds the identical database (matching `database_name`
and `database_id`) but declares no `migrations_dir` of its own, so a serial
resource keeps exactly one owner. Publish is one atomic
`INSERT ... ON CONFLICT DO NOTHING` — the first
published edition wins and is immutable under duplicate invocation. Reads
serve only by the identity pair and validate `document_json` against the
same required-`meta` edition schema used at publish; a stored row that
fails that parse is a distinct `edition_unreadable` failure, never
masqueraded as absence. Workflow step results are the durable inter-step
handoff (bounded by the platform's step-result cap and asserted, never
truncated); no separate artifact store exists, and Workflow instance state
is never the edition's durable home (ADR-005).

`generation_run_status` is direct D1 shell code, not a repository or a third
port. It holds queued/running/complete/errored progress, ordered completed
generation steps, structured terminal failure, and one usage record per
completed editorial capability. Full-array replacement makes retried status
writes idempotent; terminal rows cannot regress. Reads validate stored JSON and
cross-field state strictly, and corruption surfaces as
`generation_run_status_unreadable`, never absence or a partial projection.
This operational evidence does not replace or mutate the immutable edition.

The model provider port returns content and provenance plus truthful execution,
token-usage, and external-billing classifications. Recorded adapters report
recorded replay, unavailable token measurement, and zero external billing. The
shared OpenAI-compatible infrastructure adapter implements that existing port
for LM Studio and hosted inference. LM Studio reports local inference, validates
complete provider token counts when present, marks wholly absent counts
unavailable, and reports zero external billing. Hosted responses must carry
exactly one nonblank completion, the returned model, and complete internally
consistent provider-reported token counts. Hosted cost is calculated only from
those counts and operator-supplied per-million-token rates, retaining the
pricing reference; rates and counts are never guessed. Hosted provider
provenance is the configured provider id and model provenance is the response
model.

`MODEL_CONFIG` and eval configuration contain only non-secret adapter identity,
requested model, provider id, and pricing inputs. `LMSTUDIO_BASE_URL`,
`HOSTED_MODEL_BASE_URL`, and `HOSTED_MODEL_API_KEY` are environment-only, and a
base URL containing credentials rejects. Timeout, network/body-read failure,
and HTTP 408/409/425/429/5xx are retryable within the existing three-attempt
Workflow/re-record ceiling. Invalid configuration, ordinary 4xx, invalid JSON,
response/usage rejection, and impossible cost are deterministic. Errors and
retained evidence never contain authorization values, prompts, raw response
bodies, or response-validation detail that could echo payloads.

For local development, copy `apps/generation/.dev.vars.example` to the ignored
`apps/generation/.dev.vars`. Wrangler loads that file for the generation Worker;
the generation re-record command and eval CLI also load the same file through
Node's environment-file option. The example's active block is a complete local
three-capability `MODEL_CONFIG`; replace its model ids, start LM Studio, and run
`pnpm --filter @bc-news/generation re-record-model-responses`. Its commented
hosted alternative is complete but must replace the local block rather than be
enabled beside it. Eval gets endpoints and credentials from the same file while
adapter selection remains in the JSON passed through its `--config` option; copy
the relevant adapter objects from the example into that JSON. The committed
example contains placeholders only. Automated tests, the verifier, and the
canonical walk keep recorded or repository-owned loopback providers and never
call configured endpoints. In particular, the walk passes its recorded
three-capability `MODEL_CONFIG` as an explicit Wrangler `--var`, which takes
precedence over any local/hosted assignment in the developer's `.dev.vars`;
ordinary `pnpm --filter @bc-news/generation dev` does not add that override.

Settled — edition identity enforcement, three layers with the SQL layer
authoritative: (1) the trigger derives a deterministic Workflow instance
id from the pair, so duplicate delivery targets one instance rather than
starting a second *generation run* — observed local-emulation behavior of
a duplicate id is a silently resolved no-op, while the documented production
create rejection has no observed machine-identifiable duplicate signal. Every
create rejection therefore surfaces unchanged; classifying a production
duplicate remains a deployment-observation obligation recorded in ADR-006,
and this layer is deliberately not load-bearing; (2) the D1 pair primary key
plus insert-if-absent publish is
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
project exists. A second Worker now exists — ingest — but it serves no
client or reader traffic: it exposes only its own poll endpoint, binds the
same D1 database as the generation Worker, and carries no static assets, so
the client and `/api/edition` remain exactly the single-origin surface this
paragraph describes. The client validates at its boundary
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
absence, so the first trigger is genuinely the first), starts a node
`http` server that stubs BitJita by serving the committed
`packages/fixtures/bitjita/` corpus, starts `wrangler dev` for the
generation Worker and a second `wrangler dev` for the ingest Worker on a
`WALK_PORT`-derived port sharing the same persistence directory (so both
Workers read and write the identical local D1). It dispatches the ingest
Worker's real local scheduled event until the fixture corpus is drained,
queries that isolated local D1 to prove the exact fixture row count, and
dispatches the event again to prove dedup and overlap preserve the count.
It then dispatches the generation Worker's real local scheduled event at
the fixture publication instant, observes all nine deterministic Workflow
identities, observes an absent-evidence region fail explicitly without
blocking region 7, polls region 7's edition read until it serves and parses
the body against the shared edition schema, repeats the scheduled event and
asserts the first served edition remains byte-identical, asserts an unknown
pair answers 404, and asserts the client HTML serves. The runner honors
`WALK_PORT` end to end — both `wrangler dev` processes, both readiness
probes, the pre-spawn port-silence assertions, and the printed browser URL
all defer to it, defaulting to 8787 (generation) and 8788 (ingest) when
unset. On timeout it prints the generation run's status — failures
surface, never vanish — and the exit code reflects the assertions; shutdown
stops both `wrangler dev` processes and the stub server on every path,
success or failure. The default mode holds `wrangler dev` for human browser
observation until Ctrl-C; a non-interactive mode (`--non-interactive` or
`WALK_NON_INTERACTIVE=1`) shuts down after the assertions for automation.
The walk touches no production data, no live network, and no paid models by
construction: the walk-owned BitJita stub and the recorded model provider are
its only inputs. Generation reads evidence through `EVIDENCE_INPUT=d1_chat`,
the committed local default — the edition it publishes is generated from the
`chat_messages` rows the ingest phase just inserted from the stub corpus, not
from the fixture adapter. The fixture evidence adapter remains registered and
explicitly selectable for tests and evaluation, but it is not the local default.

The same walk uses `GET /generation-run?active_region_id=...&publication_date=...`
as the operator surface rather than requiring an opaque Workflow id. It proves
the absent-evidence pair reaches a structured prepare-evidence failure with no
model usage, and proves region 7 reaches complete with all six ordered
generation steps and exactly one recorded-replay usage record for main story,
announcements, and packaging, each with unavailable token measurement and zero
external billing. Repeated scheduled delivery must leave both edition bytes and
retained usage unchanged. The JSON response keeps the durable D1 projection
separate from a strictly parsed, explicitly available or unavailable current
Workflow observation; the id-addressed route remains a low-level diagnostic.

Settled — scheduled publication is direct Cloudflare shell code, not a third
port. The ingest Worker runs every minute and directly awaits the same
configuration-validating poll path as its manual endpoint; complete polls
return, while partial, failed, invalid-config, and unexpected failures escape
the handler with their phase and message intact. The generation Worker runs at
00:00 UTC and treats the scheduled event's supplied timestamp as the sole
clock, deriving and validating its UTC publication date before attempting one
deterministically identified Workflow instance for every entry in
`ACTIVE_REGION_IDS`. A rejected create is never classified as a duplicate by
probing for same-ID existence: local Wrangler's observed same-ID no-op resolves
successfully, while any create rejection surfaces unchanged. Unexpected launch
failures are isolated while all regions are attempted, then surfaced together
with every failed active-region/publication-date pair. Production duplicate
error classification remains an explicit deployment observation obligation.
Workflow execution remains independently isolated per region; missing evidence
therefore fails that region's run explicitly and never creates an empty or
synthetic edition for it.

## Links

- [Product requirements](PRD.md) — the constraints this posture serves.
- [Domain model](DOMAIN.md) — the vocabulary these structures implement.
- [v1 reference map](v1-reference.md) — the prior art and the failure
  modes this discipline is designed against.
