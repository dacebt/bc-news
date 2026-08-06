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
  at: "2026-08-06T21:23:59Z"
authority: binding
---

# bc-news structural discipline

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. It
binds the structural posture; the *why* is recorded in the project decision
vault (ADR-001, ADR-002, ADR-005, ADR-006, ADR-007, ADR-008, ADR-009,
ADR-014, ADR-015).

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

1. **Model provider port** — each *production model step* (see the
   [domain model](DOMAIN.md)) calls models through one interface; hosted,
   local, and recorded providers are adapters behind it. Changing a step's
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

Prepared evidence retains the inherited pre-rewrite deterministic sampler
unchanged. After the established hygiene and burst stages, it keeps at most
`MAX_MESSAGES = 300`, caps each UTC hour at 13 messages, and chooses within
those bounds by the stable FNV hash of
`activeRegionId|publicationDate|message.id`. `sampling_dropped` reports
the messages removed by that sampling stage. These are restored baseline
values, not newly tuned quality thresholds. The eval-owned context benchmark
measures exact representative requests before any later selection rule or
numeric limit is adjusted.

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
completed production model step. Full-array replacement makes retried status
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
requested model, explicit local sampling and reasoning values, provider id,
and pricing inputs. `LMSTUDIO_BASE_URL`,
`HOSTED_MODEL_BASE_URL`, and `HOSTED_MODEL_API_KEY` are environment-only, and a
base URL containing credentials rejects. Timeout, network/body-read failure,
and HTTP 408/409/425/429/5xx are retryable within the Workflow's existing
three-attempt model-call ceiling. Invalid configuration, ordinary 4xx, invalid
JSON, response/usage rejection, and impossible cost are deterministic. Errors
and retained evidence never contain authorization values, prompts, raw
response bodies, or response-validation detail that could echo payloads.

The production workflow has two editorial products and four model steps. The
main-story writer receives prepared evidence and owns `title`, `subtitle`, and
`main_story`; its copyeditor receives only that typed draft plus house rules.
The announcements writer independently receives prepared evidence; its
copyeditor receives only its typed draft plus stable internal announcement ids.
Those ids prove count, correspondence, and order through copyediting and are
stripped before publication. Copyedit preservation additionally observes
paragraph count, quotes, numeric literals, and protected markdown spans.
These mechanical checks narrow permissible mutation; they are not proof of
semantic equivalence. Code validates both final products, adds identity,
provenance, counts, and time, then assembles the edition deterministically.
There is no packaging model, judge call, score, verdict, or automatic revision
loop in production.

### Verification ownership

Verification has five independent owners. Their artifacts and terminal
observations do not cross domain boundaries.

| Owner | Command surface | Evidence | Outcome owner |
|---|---|---|---|
| Deterministic tests | `pnpm test` | Isolated invariants, reproduced defects, and high-risk state transitions | Test pass or hard test failure |
| Model evaluation | `benchmark run/list/show/summary/compare` | Strict versioned Benchmark Runs under `apps/eval/evaluation-results` | Model subject outcome and evidence-retention harness outcome, reported as `evaluation:` observations |
| Fixture and context tooling | `fixture record-responses` and `context benchmark` | Request-linked response files or strict context-result artifacts | Fixture-authoring or context-measurement tooling observations |
| Recorded-replay acceptance | `acceptance run/list/show/compare` | Historical Run Files under `apps/eval/results` | `acceptance:` gate result over controlled recorded evidence |
| Composed skeleton walk | `pnpm walk` | Running local ingest, generation, D1, API, status, and browser product | Walk-owned `walk:` observations and terminal `WALK PASS` |

Strict TypeScript and lint are supporting static guarantees, not a sixth
runtime result and not a substitute for any row.

For local development, copy `apps/generation/.dev.vars.example` to the ignored
`apps/generation/.dev.vars`. Wrangler loads that file for the generation Worker.
`MODEL_CONFIG` is strict and contains exactly
`main_story_write`, `main_story_copyedit`, `announcements_write`, and
`announcements_copyedit`. Every LM Studio adapter requires explicit finite
`temperature` and `top_p`, integer `top_k`, and a `reasoning_effort` value from
the supported roster. Non-default reasoning is sent unchanged; provider default
omits that request field. LM Studio requests use strict inline JSON schemas
derived from the same Zod contracts that validate outputs. Recorded and hosted
requests do not receive local decoding controls.

The committed recorded-response set has exactly four files:
`main_story_write.json`, `main_story_copyedit.json`,
`announcements_write.json`, and `announcements_copyedit.json`. Each record's
`prompt_sha256` binds it to the exact `{system, user}` request represented by
the artifact, but does not prove model authorship. Automated tests and the
composed skeleton walk use recorded or repository-owned loopback providers and never
call configured endpoints. The walk supplies an explicit four-step recorded
`MODEL_CONFIG`, overriding any developer `.dev.vars` model assignment.

The `fixture record-responses --fixture <path> --config <path>
[--response-dir <path>]` tooling surface requires an explicit eval configuration with one
live hosted or local adapter for each production step; the committed recorded
configuration is not a recording default. It executes exactly four dependent
calls in production-step order, so each copyeditor receives the draft produced
by its writer. Every retained response carries the exact
`(production_step, prompt_sha256)` linkage computed from the `{system, user}`
request actually sent. The recorder stages the exact four-file directory on the
same filesystem, validates every record, replays that staged set through the
shared runner, and compares only the final main-story and announcements
products before promotion. Promotion is recoverable and all-or-none at the
directory level; it does not promise continuous visibility to concurrent
readers. A failed call, validation, staged replay, or comparison leaves the
previous committed set in place. Recording has no judge, score, threshold,
byte pin, or source-digest acceptance gate.

The model-evaluation command is a separate surface:
`benchmark run --fixture <path> --config <path> [--results-dir <path>]`. Its strict
benchmark declaration contains a nonempty ordered list of exact four-step live
configurations, a positive repetition count, and an explicit transport retry
limit from zero through three. Recorded adapters and duplicate configuration
identities reject before artifact creation. Historical run files keep their
existing directory, schema, and meaning. The eval application owns this
artifact boundary directly, adding no third domain port.

The artifact is exclusively created in `running` state before any provider
call. Before transport, it atomically retains the exact assembled
`{production_step, system, user}` request, request hash, configuration identity,
ordinal, predecessor link, timestamp, `transport: in_flight`, and
`parse: pending`. A successful application-facing completion is retained while
parse remains pending before editorial parsing. A transport failure is retained
with classification pending and then classified in a separate write. An
eligible failure may append at most the declared number of retries; each retry
points to the immediately previous same-step invocation and retains the exact
same request and request hash. Deterministic transport failures and model-level
parse, contract, preservation, or final-product findings never retry. Every
replacement validates and reparses
before becoming authoritative. A failed pre-rename replacement always attempts
to remove its unique temporary file without changing the authoritative bytes.
Cleanup is best-effort: a cleanup failure remains an explicit harness-failure
detail with the temporary path while the primary error stays classified as
`write_rejected`. Evidence-write failure
stops the harness and never claims retention; interruption leaves the last
strict running artifact inspectable. Ended invocation durations equal their
retained timestamp endpoints exactly, and trial and benchmark completions
cannot precede any lifecycle event they contain.

Artifact version 2 retains the exact declared configuration-order and
repetition-order trial roster. Its trials are an append-only prefix: only the
final retained trial may run, terminal predecessors are immutable, and outcome
counts exactly reflect every retained terminal trial. Provider exhaustion
closes only the affected editorial track as infrastructure-incomplete;
main-story and announcements execute independently, and a rejected or
infrastructure-incomplete trial does not suppress later roster members. A
benchmark becomes retained only after every declared trial is terminal.
Invalid artifact state or persistence stops coordination.

Retained Benchmark Runs are browsed through the namespaced `benchmark list`,
`benchmark show`, `benchmark summary`, and `benchmark compare` eval routes.
Their application boundary reads only `evaluation-results/<id>.json`, validates
every loaded file through the version-dispatched Benchmark Run contract, binds
the filename to the artifact id, and rejects corrupt evidence rather than
skipping it. Historical Run Files retain their distinct schema and
`apps/eval/results` directory and are owned only by `acceptance run`,
`acceptance list`, `acceptance show`, and `acceptance compare`; they are never
relabeled as Benchmark Runs.

Benchmark comparison projects context and behavior independently. Context owns
the exact fixture and prepared evidence, configuration and retry/repetition
policy, and code/output-contract provenance. Behavior owns lifecycle and
harness outcome, ordered trial and track outcomes, findings, products,
requests, completions or failures, usage, billing, duration, and stable
retry/selection relationships. Run, trial, and invocation ids plus absolute
timestamps do not create behavioral differences. This observation boundary
reports exhaustive paths only; it owns no score, judge, recommendation, or
acceptance decision.

Main-story and announcements evaluation tracks execute independently. A
rejection in one does not suppress the other. Final-product findings are pure
deterministic checks attributed to each track's terminal copyedit step;
production retains its aggregate throwing wrapper and hard-failure behavior.
Subject outcome describes model behavior, while harness outcome states only
whether trustworthy evidence was retained.

Artifact version 1 is a historical-validation boundary, not an alias for the
current production implementation. Eval-local frozen schemas, parsers, writer
prompts and transcript fencing derived from retained prepared evidence,
copyedit prompt/fencing relations, preservation rules, announcement-ID
attachment, and deterministic final-product checks exclusively validate v1
artifacts. Its retained output-contract tuple must exactly equal the ordered
representations and hashes derived from those frozen schemas. The artifact also
retains the complete prepared-evidence snapshot; its identity hash and summary
fields bind that snapshot. A completed track requires its selected copyedit
product with zero derived findings; a final-product rejection requires that
same selected product with the exact nonempty derived finding set; every other
rejection retains neither a product nor track-level findings. Production execution continues to use
the current shared generation implementation. A production behavior change
therefore requires a new artifact version rather than silently changing the
meaning of retained v1 evidence.

V1 code provenance is exactly `repository: bc-news`, a validated 40-character
commit SHA, and `dirty: false`. Evaluation starts only from that clean commit;
no second unbound workspace digest competes with the commit identity.

Artifact version 1 remains the single-configuration, repetition-one historical
boundary and retains its original transition semantics. Version 2 alone owns
the serial roster, positive repetitions, linked retries, multi-trial outcome
counts, and benchmark continuation. The version-dispatched store rejects a
cross-version replacement.

The representative local version-2 declaration contains exactly four
configurations, in order: `qwen/qwen3.5-9b`, `openai/gpt-oss-20b`,
`prism-ml/bonsai-27b`, and `google/gemma-4-e4b`. Each configuration assigns the
same model to all four production steps with `temperature: 1`, `top_p: 0.95`,
`top_k: 20`, and `reasoning_effort: none`; the declaration uses one repetition
and a transport retry limit of one. It remains ignored local evidence, runs
serially through `benchmark run`, and is inspected through `benchmark summary`.
The summary must retain every actual trial outcome and exact configuration
identity; it does not decide quality or acceptance.

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
model usage, and proves region 7 reaches complete with all seven ordered
generation steps and exactly one recorded-replay usage record for each of the
four production model steps, each with unavailable token measurement and zero
external billing. It proves deterministic assembly serves the two recorded
copyedited products. Repeated scheduled delivery must leave both edition bytes and
retained usage unchanged. The walk does not invoke evaluation, fixture-authoring,
context, or recorded-replay acceptance verifiers. It owns only its composed
product observations and terminal `WALK PASS`; the exact successful observations
from those direct verifiers must not appear in walk output.

Recorded-replay acceptance executes the four dependent production steps twice,
writes only below its owned temporary directory when no results directory is
supplied, and reloads through the strict Run File schema. The two executions
must be identical apart from run identity and the two timestamps, which proves
recorded replay deterministic by re-execution rather than against a stored file,
and every differing path is reported rather than the first. Recorded-replay
semantics require the exact ordered roster, four recorded-replay
usages at zero external billing, outputs equal to the parsed recorded responses,
request stamps recomputed from current builders and each step's actual input,
and a final assembled edition equal to the two copyedited products. The evidence
fixture remains identified by workspace-relative path and current bytes.
Recorded-replay acceptance has no model judge, quality threshold, byte pin, or source
digest gate; retained output and source fingerprints remain human comparison
evidence. Its direct verifier prints
`acceptance: four recorded production steps replayed request-linked and deterministic`
only after success.

Exact context-budget measurement is invoked as `context benchmark --fixture
<path> [--results-dir <path>]`. It is eval tooling, not a production port.
It reuses the production prompt builders, strict structured-output contracts,
and pure LM Studio request builder, while an eval-local SDK runtime only lists
the loaded LLM, applies its chat template, counts with its tokenizer, and reads
its configured context length. The live command requires exactly one loaded
Qwen model and the same model id across all four production-step configs; it
never loads, switches, unloads, or contacts a hosted model.

The representative evidence corpus produces 208 prepared messages under the
unchanged sampler, so its fixed measurement matrix is 1, 50, 100, 150, and 208.
Each load preserves the retained message order and builds both copyedit requests
from that load's actual writer drafts. Provider-reported usage is reconciled
against model-native template/token counts and written as strict JSON. Schema
constraints are recorded by name and digest rather than assigned a fictional
token cost. This architecture still introduces no filtering, retrieval, or
chunking policy; the production 300-message and 13-per-hour limits remain intact.

The final reader check launches installed Google Chrome through
`playwright-core`, blocks service workers, and installs a request-aborting
same-origin route before the first navigation. It derives expected paper
content from the strict-parsed served edition and proves the published paper,
two unavailable selections, normalized controls and query, and browser Back
restoration. The region-8 and prior-date edition 404s are the only permitted
non-2xx responses. Chrome's exact 404 console message and aborted-request event
are ignored only when their exact URL was already observed and strictly
classified as one of those two allowed responses; every uncorrelated external
origin, failed request, page error, or console error rejects. Chrome is a local prerequisite and is never downloaded by the
walk. One idempotent cleanup owner closes Chrome, both Wrangler process groups,
and the BitJita stub, removes the walk directory (including D1 and eval output),
and unregisters SIGINT handling on every path. Cleanup failures are reported
without replacing the primary result. The JSON response keeps the durable D1 projection
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
