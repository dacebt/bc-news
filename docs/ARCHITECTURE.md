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
generation steps, structured terminal failure, one usage record per completed
production model step, and ordered editorial diagnostics. Full-array
replacement makes retried status writes idempotent; terminal rows cannot
regress. Reads validate stored JSON and cross-field state strictly, and
corruption surfaces as
`generation_run_status_unreadable`, never absence or a partial projection.
This operational evidence does not replace or mutate the immutable edition;
diagnostics live in generation status and never enter `EditionSchema`.

The model provider port returns content and provenance plus truthful execution,
token-usage, and external-billing classifications. Recorded adapters report
recorded replay, unavailable token measurement, and zero external billing. The
shared model-adapter package implements that existing port with the native LM
Studio SDK for local inference and a separate OpenAI-compatible adapter for
hosted inference. LM Studio selects an already-loaded model without loading or
unloading model state, reports local inference, validates complete provider
token counts when present, marks wholly absent counts unavailable, and reports
zero external billing. Hosted responses must carry
exactly one nonblank completion, the returned model, and complete internally
consistent provider-reported token counts. Hosted cost is calculated only from
those counts and operator-supplied per-million-token rates, retaining the
pricing reference; rates and counts are never guessed. Hosted provider
provenance is the configured provider id and model provenance is the response
model.

The provider-facing `ModelCompletion` may also carry normalized runtime
evidence for evaluation. Published `ModelUsageRecord` remains an explicit
legacy-field projection of provider, returned model, execution, token usage,
and billing, so runtime evidence cannot enter Edition or generation-status
contracts accidentally. The native SDK dependency and the exported application
release constant are pinned exactly to `@lmstudio/sdk` 1.5.0; a test-only
metadata-resolution proof verifies the installed package without making
production code traverse package internals.

`MODEL_CONFIG` and eval configuration contain one complete independent
configuration per production agent: non-secret adapter identity, requested
model, optional temperature, and adapter-specific reasoning or billing
declarations. `LMSTUDIO_BASE_URL`,
`HOSTED_MODEL_BASE_URL`, and `HOSTED_MODEL_API_KEY` are environment-only, and a
base URL containing credentials rejects. Native LM Studio timeout, model
availability, SDK, and transport failures are retryable by default. Hosted
timeout, network/body-read failure, and HTTP 408/409/425/429/5xx are retryable
within the Workflow's existing three-attempt model-call ceiling. Invalid
configuration, loaded-model resolution, incomplete output, response/usage
rejection, ordinary hosted 4xx, invalid hosted JSON, and impossible cost are
deterministic. Errors
and retained evidence never contain authorization values, prompts, raw
response bodies, or response-validation detail that could echo payloads.

The production workflow has two editorial products and four model steps. The
main-story writer receives prepared evidence and owns `title`, `subtitle`, and
`main_story`; its copyeditor receives only that typed draft plus house rules.
The announcements writer independently receives prepared evidence; its
copyeditor receives only its typed draft plus stable internal announcement ids.
Those ids support count, correspondence, and order diagnostics through
copyediting and are stripped before publication. Malformed JSON or strict
schema mismatch is the only terminal model-output failure. Infrastructure and
provider failures are a separate failure class. Every schema-valid grammar,
punctuation, markdown, wording, preservation, or editorial-policy finding is an
ordered non-terminal diagnostic after the single copyedit pass; it never causes
another model call, model-output rejection, or publication stop. Preservation
diagnostics observe field shape, paragraph count, quotes, numeric literals, and
protected markdown spans, but do not prove semantic equivalence. Code retains
the diagnostics, adds identity, provenance, counts, and time, then assembles and
publishes both final products deterministically. There is no packaging model,
judge call, score, verdict, or automatic revision loop in production.

### Verification ownership

Verification has seven independent owners. Their artifacts and terminal
observations do not cross domain boundaries.

| Owner | Command surface | Evidence | Outcome owner |
|---|---|---|---|
| Deterministic tests | `pnpm test` | Isolated invariants, reproduced defects, and high-risk state transitions | Test pass or hard test failure |
| Model evaluation | `benchmark run/list/show/summary/compare` | Strict versioned Benchmark Runs under `apps/eval/evaluation-results` | Model subject outcome and evidence-retention harness outcome, reported as `evaluation:` observations |
| Evaluation reference corpus | `corpus show --corpus <manifest-path>` | Strict ordered synthetic fixtures and exact source-witness references | Auditable source truth and objective variation coverage; no model result or verdict |
| Evaluation scorecards | `scorecard build/show` | Exact retained Benchmark Runs, corpus sources, human annotations, and human qualitative reviews | Four role-specific transparent evidence reports; no aggregate score, ranking, recommendation, or acceptance verdict |
| Fixture and context tooling | `fixture record-responses` and `context benchmark` | Request-linked response files or strict context-result artifacts | Fixture-authoring or context-measurement tooling observations |
| Recorded-replay acceptance | `acceptance run/list/show/compare` | Historical Run Files under `apps/eval/results` | `acceptance:` gate result over controlled recorded evidence |
| Composed skeleton walk | `pnpm walk` | Running local ingest, generation, D1, API, status, and browser product | Walk-owned `walk:` observations and terminal `WALK PASS` |

Strict TypeScript and lint are supporting static guarantees, not an eighth
runtime result and not a substitute for any row.

For local development, copy `apps/generation/.dev.vars.example` to the ignored
`apps/generation/.dev.vars`. Wrangler loads that file for the generation Worker.
`MODEL_CONFIG` is strict and contains exactly
`main_story_write`, `main_story_copyedit`, `announcements_write`, and
`announcements_copyedit`. Every LM Studio adapter requires
`reasoning_effort: provider_default`. Finite `temperature` from zero through two
is the only application-owned decoding control and is optional independently on
every step. Omission sends no temperature override for that agent. `top_p` and
`top_k` are not admitted or sent. Invalid or obsolete fields reject rather than
being completed or approximated by the application. The
native SDK request omits reasoning effort because its public prediction options
do not expose that control; explicit effort values reject instead of being
approximated. LM Studio requests use strict inline JSON schemas
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

Current recorded-response version 3 artifacts retain the exact adapter, model,
optional temperature, and adapter-specific declarations for each production
step. Absent-version and version 2 responses keep their historical meaning and
remain parseable. Fixture authoring may omit or set temperature independently
for every step; retained configuration is evidence, not a replay instruction.

The model-evaluation command is a separate surface:
`benchmark run --fixture <path> --config <path> [--results-dir <path>]`. Its strict
benchmark declaration contains a nonempty ordered list of exact four-step live
configurations, a positive repetition count, and an explicit transport retry
limit from zero through three. Recorded adapters and duplicate configuration
identities reject before artifact creation. Historical run files keep their
existing directory, schema, and meaning. Configuration-order and
repetition-order roster members execute serially. Within each Evaluation Trial,
the main-story and announcements writer-to-copyeditor chains dispatch
concurrently, while each writer remains a prerequisite for its own copyeditor.
This is application scheduling, not a promise that an underlying model runtime
processes the requests in parallel. The eval application owns this artifact
boundary directly, adding no third domain port and changing neither provider
adapters nor production Workflow scheduling.

The evaluation reference corpus is selected only through `corpus show
--corpus <manifest-path>`. Its V1 manifest owns positional order, canonical
fixture/reference paths, exact byte hashes, and closed variation tags with
objective witnesses. The committed corpus contains twelve synthetic
conversations. Each separate strict reference uses exact excerpts from named
message fields for claims, events, ambiguities, noteworthy candidates,
entities, and raw numeric text; status shapes distinguish established,
contested, and unresolved evidence without supplying replacement prose.

Loading runs every fixture through `EvidenceFixtureSchema` and the real
`prepareEvidence` path. Every cited identity and excerpt must survive under the
same message id. Directory contents must exactly match the manifest, and
canonicalization, realpath containment, symlink rejection, and exact hashes
prevent implicit selection or unowned evidence. Dense/sparse thresholds,
event-time relationships, contradiction roles, unresolved records, grounded
names/numbers, announcement candidates, and explicit irrelevant-message ids
make variation tags auditable rather than decorative. Existing valid
single-fixture commands, artifacts, and outputs remain unchanged; no existing
namespace accepts `--corpus`.

Evaluation scorecards are a separate eval-owned evidence boundary selected only
through `scorecard build --input <declaration-path> [--results-dir <path>]` and
`scorecard show <scorecard-id> [--results-dir <path>]`. A declaration binds one
exact configuration to the complete ordered reference corpus, every complete
retained version 7 Benchmark Run for that corpus, exact human output
annotations, and separate human qualitative reviews. No Benchmark Run, corpus
entry, production prompt, retry policy, generation path, or historical artifact
is changed by scorecard construction, and this boundary adds no domain port.

Each strict scorecard artifact embeds the exact declaration, manifest,
fixture/reference pairs, Benchmark Runs, annotation bundle, and qualitative
review bundle. Loading reconstructs the real corpus boundary in an isolated
temporary root and recomputes every source hash, output identity, context
identity, count, rate, 95% Wilson interval, distribution, and qualitative
summary before accepting the artifact. Reports contain exactly four separate
production-role sections. Deterministic measurements expose named units,
denominators, sample counts, and unavailable or inapplicable states. Semantic
grounding, attribution, event coverage, announcement relevance, coherence,
usefulness, newsworthiness, and voice remain visibly human-authored evidence.
There is no weighted or combined score, model rank, winner, threshold,
recommendation, acceptance verdict, retry trigger, or production selection.

Current Benchmark Run artifact version 7 retains every exact per-agent adapter,
model, optional temperature, and adapter-specific declaration plus every exact
copyedit diagnostic and a top-level runtime-evidence record for every reached
invocation. Temperature omission and presence are independent
candidate choices for each role. Obsolete decoding controls reject before
artifact creation. Its four subject outcomes are `completed`, `parse_rejected`,
`contract_rejected`, and `infrastructure_incomplete`. Versions 1–5 remain
version-dispatched historical boundaries, version 6 retains the prior
per-agent configuration contract without runtime evidence, and all versions
1–6 keep their frozen semantics.

The artifact is exclusively created in `running` state before any provider
call. One ordered application owner allocates every invocation ordinal and
applies every retained version 7 mutation. Before each transport call, that
owner atomically retains the exact assembled `{production_step, system, user}`
request, request hash, configuration identity, ordinal, predecessor link,
timestamp, `transport: in_flight`, and `parse: pending` together with an
identity-matched `runtime_evidence: pending` record. Concurrent track work
therefore enters one monotonic interleaved history, and the artifact store's
atomic full-file replacement is never invoked concurrently. A successful
application-facing completion is retained without its optional provider-facing
runtime field while its roster record atomically becomes `captured` and parse
remains pending before editorial parsing. A transport failure atomically makes
its runtime record `unavailable: transport_failed` and is retained with
classification pending and then classified in a separate write. An eligible failure may append at most
the declared number of retries; each retry points to the immediately previous
same-step invocation and retains the exact same request and request hash.
Deterministic transport failures, malformed JSON, and strict schema mismatch
never retry. Preservation and final-product findings complete their track with
the schema-valid product and retained diagnostics, also without retry. Every
replacement validates and reparses before becoming authoritative. A failed
pre-rename replacement always attempts to remove its unique temporary file
without changing the authoritative bytes.
Cleanup is best-effort: a cleanup failure remains an explicit harness-failure
detail with the temporary path while the primary error stays classified as
`write_rejected`. Evidence-write failure stops the harness and never claims
retention. Validation, persistence, or an unknown harness rejection prevents
terminal retained completion. Both concurrently dispatched chains quiesce
before the application attempts terminal trial aggregation, so no sibling can
mutate evidence after a terminal result is reported. Interruption leaves the
last strict running artifact inspectable through the same version-dispatched
benchmark browse boundary. Ended invocation durations equal their retained
timestamp endpoints exactly, and trial and benchmark completions cannot precede
any lifecycle event they contain.

Runtime evidence uses application-owned strict observations rather than raw
provider configuration. Every field is `observed`, `unknown`, or
`externally_controlled` with a closed reason; invalid strings, counts, context
lengths, timing, throughput, or speculative-token relations become canonical
unknowns rather than nulls, non-finite JSON, or guessed descriptions. The
execution context owns the pinned client SDK release, provider runtime,
distinct selected and response model identities including reported architecture,
parameter-count, quantization, vision, and tool-use capabilities, load/context identity,
requested and effective reasoning posture, and speculative draft-model
identity. Prediction observation owns stop reason, first-token and total time,
throughput, speculative counts, and reasoning-content presence. LM Studio uses
only stable public SDK observations; deprecated raw load and prediction config
objects and the SDK's incorrect GPU-layer statistic are not retained. Auxiliary
version, model-info, or context observation failure or observation timeout does
not turn successful inference into a transport failure. Hosted adapters retain
the identities and stable response observations they receive without treating a
requested alias as an observed selected identity, and explicitly mark
provider-owned or unreported runtime fields. A successful live completion
without runtime evidence is an evaluator evidence failure that leaves the
provider-success attempt represented by an in-flight invocation with pending
evidence in the last strict running artifact rather than fabricating a transport
failure.

Artifact version 2 retains the exact declared configuration-order and
repetition-order trial roster. Its trials are an append-only prefix: only the
final retained trial may run, terminal predecessors are immutable, and outcome
counts exactly reflect every retained terminal trial. Provider exhaustion
closes only the affected editorial track as infrastructure-incomplete; expected
provider exhaustion or subject rejection is track-local and does not suppress
the concurrently advancing sibling. A rejected or infrastructure-incomplete
trial does not suppress later serial roster members. A benchmark becomes
retained only after every declared trial is terminal. Invalid artifact state or
persistence stops coordination.

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
policy, code/output-contract provenance, and version 7 execution-context
evidence. Behavior owns lifecycle and
harness outcome, ordered trial and track outcomes, findings, products,
requests, completions or failures, usage, billing, duration, and stable
retry/selection relationships plus version 7 prediction observations. Run,
trial, and invocation ids plus absolute timestamps do not create behavioral differences. This observation boundary
reports exhaustive paths only; it owns no score, judge, recommendation, or
acceptance decision.

Main-story and announcements evaluation tracks dispatch concurrently and
execute independently as two track-local writer-to-copyeditor chains. A
rejection or exhausted provider in one does not suppress the other, and both
chains quiesce before terminal aggregation. Preservation and final-product
findings are deterministic diagnostics attributed to each track's terminal
copyedit step; a schema-valid product completes its track with those diagnostics
retained. Subject outcome describes model behavior, while harness outcome states
only whether trustworthy evidence was retained. This scheduling change does not
alter the frozen version 6 artifact schema, its inherited version 5 subject
semantics, or any historical version meaning.

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
boundary and retains its original transition semantics. Versions 2 and 3 own
the serial roster, positive repetitions, linked retries, multi-trial outcome
counts, and benchmark continuation. Version 2 keeps the original prompt and
copyedit-preservation semantics frozen. Version 3 freezes the corrected writer
field-purpose contracts and treats leading or trailing whitespace-only
separators as boundary whitespace while continuing to protect interior
paragraph structure. Version 4 adds its frozen provider-default versus complete
explicit LM Studio sampling contract without changing versions 1–3. Version 5
retains that historical sampling contract while adding schema-valid
preservation and final-product diagnostics with completed products and narrowing
terminal model-output outcomes to malformed JSON or strict schema mismatch.
Version 6 replaces the run-wide sampling posture with exact independent
per-agent configurations and optional temperature only. Version 7 is current:
it preserves those declarations and adds the lifecycle-matched normalized
runtime-evidence roster while keeping legacy completion objects unchanged. The
version-dispatched store rejects a cross-version replacement.

Model evaluation declarations assign an exact configuration to every role and
may vary model and temperature independently across those roles. Omitting
temperature for one role includes that provider default as a candidate without
affecting the other three. Declarations retain repetition and transport retry
limits as run-level experiment and infrastructure controls. Results are
inspected through `benchmark summary`; the summary retains every actual trial
outcome and exact configuration identity but does not decide quality or
acceptance.

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
external billing. It strictly observes the exact ordered preservation and
final-product diagnostics carried by the representative schema-valid copyedit,
then proves deterministic assembly serves that copyedited product. Repeated
scheduled delivery must leave edition bytes, retained usage, and retained
diagnostics unchanged. The walk does not invoke evaluation, fixture-authoring,
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
ordered diagnostics, and a final assembled edition equal to the two copyedited
products. Current Run Files require diagnostics; historical files without that
field report diagnostic evidence as unknown rather than an empty observation.
The legacy single evidence fixture remains identified by workspace-relative
path and current bytes. The nested evaluation reference corpus is a separate
explicitly selected boundary and is never an implicit replacement for it.
Recorded-replay acceptance has no model judge, quality threshold, byte pin, or source
digest gate; retained output and source fingerprints remain human comparison
evidence. Its direct verifier prints
`acceptance: four recorded production steps replayed request-linked and deterministic; diagnostics retained: 4`
only after success.

Exact context-budget measurement is invoked as `context benchmark --fixture
<path> [--results-dir <path>]`. It is eval tooling, not a production port.
It reuses the production prompt builders, strict structured-output contracts,
and pure LM Studio request builder, while an eval-local SDK runtime only lists
the loaded LLM, applies its chat template, counts with its tokenizer, and reads
its configured context length. The live command requires exactly one loaded
Qwen model and the same model id across all four production-step configs; it
never loads, switches, unloads, or contacts a hosted model.

Current context-result version 3 artifacts retain the exact four independent LM
Studio agent configurations and optional temperatures. Version 2 and
absent-version context results retain their historical meanings. The command
requires one loaded model because it measures one runtime context, but each role
still retains and uses its own temperature choice.

The representative evidence corpus produces 208 prepared messages under the
unchanged evidence-message sampler, so its fixed measurement matrix is 1, 50,
100, 150, and 208.
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
