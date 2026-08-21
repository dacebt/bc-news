---
type: doc
title: >-
  bc-news structural discipline
description: >-
  The binding architecture posture for bc-news v2 — TypeScript application code throughout, exactly two ports (model provider, evidence input), functional core with zod-validated rejecting boundaries, and deliberate Cloudflare coupling everywhere else.
tags: [documentation, architecture, ports, typescript]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:55:35Z"
authority: binding
---

# bc-news structural discipline

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. It
binds the structural posture; the *why* is recorded in the project decision
vault (ADR-001, ADR-002, ADR-005, ADR-006, ADR-007, ADR-008, ADR-009,
ADR-014, ADR-015).

## Language

The application implementation is **TypeScript throughout** — workers, the
Workflow, the eval harness, the client, shared contract packages, and the local
walk. Repository support material still uses the formats its tools require,
including SQL migrations, JSON/JSONC configuration, shell entrypoints, and
Markdown documentation; none forms a second application stack. v1 already paid
once to unwind a split application stack (see the [v1 reference
map](v1-reference.md)).

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
masqueraded as absence. Public reads require exactly one known query parameter
for each member of an active pair. They pass a per-client-address Cloudflare
rate limiter before validation, cache, or D1; successful validated editions use
a fresh canonical pair-addressed Cache API key and one-hour edge TTL, while
invalid, absent, unreadable, and rate-limited responses are never cached. Cache
entries are local to one Cloudflare location and are an abuse/cost control, not
the edition's durable home. Workflow step results are the durable inter-step
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
zero external billing. Hosted responses must carry exactly one choice whose
application content is either nonblank text or an explicit provider-reported
null, plus the returned model and complete internally consistent
provider-reported token counts. Explicit null content is retained as a
successful transport result and rejected at the editorial schema boundary as
model output; missing, blank, or otherwise malformed content remains a provider
response-contract failure. Hosted cost is calculated only from
those counts and operator-supplied per-million-token rates, retaining the
pricing reference; rates and counts are never guessed. Hosted provider
provenance is the configured provider id and model provenance is the response
model.

The provider-facing `ModelCompletion` may also carry normalized runtime
evidence for evaluation. `ModelUsageRecord` retains Cloudflare Gateway request
provenance when present, including the response-scoped log id and explicit
request policy; runtime evidence still cannot enter Edition accidentally. The native SDK dependency and the exported application
release constant are pinned exactly to `@lmstudio/sdk` 1.5.0; a test-only
metadata-resolution proof verifies the installed package without making
production code traverse package internals.

`MODEL_CONFIG` and eval configuration contain one complete independent
configuration per production agent: non-secret adapter identity, requested
model, optional adapter-specific inference settings, and reasoning or billing
declarations. `LMSTUDIO_BASE_URL`,
`HOSTED_MODEL_BASE_URL`, `HOSTED_MODEL_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, and
`CLOUDFLARE_API_TOKEN` are environment-only, and a
base URL containing credentials rejects. Native LM Studio timeout, model
availability, SDK, and transport failures are retryable by default. Hosted
timeout, network/body-read failure, and HTTP 408/409/425/429/5xx are retryable
within the Workflow's existing three-attempt model-call ceiling. Invalid
configuration, loaded-model resolution, missing or blank output, response/usage
rejection, ordinary hosted 4xx, invalid hosted JSON, and impossible cost are
deterministic. Errors and retained evidence never contain authorization values,
prompts, raw response bodies, or rejected response values. Provider
response-contract failures retain only the contract identifier, schema path,
issue code, expected type, received structural type, and unexpected field names
needed to locate the mismatch. Rejected values remain absent.

`cloudflare_ai_gateway` uses the official account REST API in both the Worker
and Node evaluation runtime. The Worker binding is not used: its current
per-request contract lacks payload suppression, attempt count, and timeout
controls, while its log id names the most recent binding request rather than
the specific response. The REST adapter fixes the Cloudflare host, derives
provider identity from `author/model` (or `workers_ai` from `@cf/author/model`),
selects the exact profiled `POST /ai/v1/chat/completions` or `POST
/ai/v1/responses` endpoint, sets cache bypass, metadata-only logging, one
Gateway attempt, and a ten-minute timeout, and requires run/invocation
correlation before transport. Unified Billing owns third-party keys.
Gateway-estimated cost is absent from the inference response, so the completion
records billing as unavailable and retains `cf-aig-log-id` for separately
authorized reconciliation when Cloudflare reports it and otherwise records the
response header as unavailable evidence. For a deterministic non-2xx
rejection, the adapter retains the bounded provider error code, message,
parameter path, and HTTP status without retaining a raw response body.
Gateway model selection is closed over researched exact-model request profiles.
Each profile owns its Cloudflare request format, provider-side structured-output
encoding, buffered-or-streaming response delivery, and provider identity.
Streaming profiles accumulate the complete SSE response before the unchanged
strict completion contract and canonical production parser run. OpenAI Chat
profiles adapt canonical optional fields to required nullable wire fields and
normalize returned null placeholders back to omitted application fields before
canonical parsing. The Luna Responses profile uses `input` role preservation
plus `text.format.type=json_schema`; it accepts only a `completed` response
whose `output` contains zero or more `reasoning` items plus exactly one
completed assistant message with one or more nonblank `output_text` items,
concatenated in order without separators, and it retains the returned
unqualified response model without requiring equality with the routed
`author/model` request id. The admitted profiles are
`openai/gpt-5-nano`, `openai/gpt-5-mini`, `openai/gpt-5.6-luna`,
`openai/gpt-4o`, `openai/gpt-4o-mini`, `alibaba/qwen3.5-397b-a17b`,
`google/gemini-2.5-flash-lite`, `google/gemini-3.1-flash-lite`,
`google/gemini-3.7-flash`, `minimax/m3`, `@cf/openai/gpt-oss-120b`, and
`@cf/google/gemma-4-26b-a4b-it`; an unprofiled model rejects as invalid
configuration. Every profiled request sends the production step's strict inline
JSON Schema and leaves the provider's output-token ceiling unset. Successful
Gateway provenance retains the exact request format, response-delivery mode,
and structured-output contract name in addition to the existing transport
policy.
Current evaluation artifacts are version 9. Historical Benchmark Run versions 7
and 8 remain readable; version 8 alone retained explicit null completion
content, while historical non-Gateway version 7 required textual completion
content.

The production workflow has two editorial products and two model steps. The
main-story writer receives prepared evidence and owns `title` plus
`main_story.headline`, `main_story.lede`, and `main_story.body`. The
announcements writer independently receives prepared evidence and owns the final
ordered announcement list. Malformed JSON or strict schema mismatch is the only
terminal model-output failure. Infrastructure and provider failures are a
separate failure class. Every schema-valid grammar, punctuation, markdown,
wording, preservation, or editorial-policy finding is an ordered non-terminal
diagnostic on writer output; it never causes another model call,
model-output rejection, or publication stop. Code retains diagnostics,
validates output, normalizes unambiguous decoded strings, adds identity,
writer provenance, counts, and time, then assembles and publishes both final
products deterministically. There is no packaging model, judge call, score,
verdict, or automatic revision loop in production. If evidence preparation
reaches `final_count === 0`, the run fails before inference. With at least one
prepared message, schema-valid writer output continues with no abstention or
no-story branch.
the diagnostics, adds identity, provenance, counts, and time, then assembles and
publishes both final products deterministically. There is no packaging model,
judge call, score, verdict, or automatic revision loop in production.

### Verification ownership

Verification has ten independent owners. Their artifacts and terminal
observations do not cross domain boundaries.

| Owner | Command surface | Evidence | Outcome owner |
|---|---|---|---|
| Deterministic tests | `pnpm test` | Isolated invariants, reproduced defects, and high-risk state transitions | Test pass or hard test failure |
| Scratch model run | `scratch run` | One caller-directed live two-writer inspection artifact | Development observation only; no Benchmark Run, scorecard, baseline, or acceptance verdict |
| Model evaluation | `benchmark run/list/show/summary/compare` | Strict versioned Benchmark Runs under `apps/eval/local-data/evaluation-results` by default | Model subject outcome and evidence-retention harness outcome, reported as `evaluation:` observations |
| Evaluation reference corpus | `corpus extract --snapshot <sqlite-path> --selection <selection-path>` and `corpus show --corpus <manifest-path>` | Current local V3 selection-bound corpus workspaces under `apps/eval/local-data/corpus-workspaces/` plus historical Git-addressed V2 synthetic readers | Auditable source truth and objective variation coverage; no model result or verdict |
| Evaluation scorecards | `scorecard build/show` | Current local hash-addressed scorecards under `apps/eval/local-data/scorecards` by default, plus embedded V1 and Git-addressed V2 historical readers | Four role-specific transparent evidence reports plus current/outdated checkout information; no aggregate score, ranking, recommendation, or acceptance verdict |
| Aggregate evaluation results | `aggregate export/show/compare` | Strict content-free aggregate JSON under `apps/eval/summaries/` by default, with `cohort.evidence_identity_sha256` bound to the source corpus identity | Descriptive role aggregates only: subject descriptor, counts, rates and intervals, aggregate distributions, and qualitative counts; never source or model-output evidence, a winner, a rank, a recommendation, acceptance, or production selection |
| Longitudinal evaluation scorecards | `longitudinal build/show` | Current local hash-addressed series under `apps/eval/local-data/longitudinal-scorecards` by default, plus embedded V1 and Git-addressed V2 historical readers | Four role-specific evidence classifications; no model judge, acceptance verdict, or production decision |
| Fixture and context tooling | `fixture record-responses` and `context benchmark` | Step-keyed response files or strict context-result artifacts | Fixture-authoring or context-measurement tooling observations |
| Recorded-replay acceptance | `acceptance run/list/show/compare` | Current local Run Files under `apps/eval/local-data/acceptance-results` by default, plus historical readers when explicitly addressed | `acceptance:` gate result over controlled recorded evidence |
| Composed skeleton walk | `pnpm walk` | Running local ingest, generation, D1, API, status, and browser product | Walk-owned `walk:` observations and terminal `WALK PASS` |

Strict TypeScript and lint are supporting static guarantees, not an eleventh
runtime result and not a substitute for any row. The binding [test and
verification posture](TESTING.md) owns the full commands, artifact contracts,
and success observations for all ten surfaces; this table preserves only their
architectural separation.

For local development, copy `apps/generation/.dev.vars.example` to the ignored
`apps/generation/.dev.vars`. Wrangler loads that file for the generation Worker.
`MODEL_CONFIG` is strict and contains exactly
`main_story_write` and `announcements_write`. Every LM Studio adapter requires
`reasoning_effort: provider_default`. Each step may independently declare
`temperature` from zero through two, `top_p` from zero through one, `top_k` from
one through 500, and boolean `enable_thinking`. Each omitted field independently
uses the loaded model's LM Studio inference default. One typed application
configuration maps those names once to the native SDK's `temperature`,
`topPSampling`, `topKSampling`, and `enableThinking` request options. Invalid or
obsolete fields reject rather than being completed or approximated by the
application. `reasoning_effort` remains a declaration rather than an SDK request
field; explicit effort values reject instead of being approximated. LM Studio
and profiled Gateway requests use strict inline JSON schemas derived from the
same Zod contracts that validate outputs. Recorded requests receive no provider
decoding controls.

The committed recorded-response set has exactly two files:
`main_story_write.json` and `announcements_write.json`. Each record's
`prompt_sha256` is inert metadata describing the request observed when the
artifact was created. Current code never compares it with prompt builders or
uses it as a development gate. Automated tests and the composed skeleton walk
use recorded or repository-owned loopback providers and never call configured
endpoints. The walk supplies an explicit two-step recorded
`MODEL_CONFIG`, overriding any developer `.dev.vars` model assignment.

The `fixture record-responses --fixture <path> --config <path>
[--response-dir <path>]` tooling surface requires an explicit eval configuration
with either `lmstudio` or `openai_compatible_hosted` for each production step.
The `recorded` adapter rejects because replay is not live recording, and
`cloudflare_ai_gateway` rejects because the current recorder contract cannot
retain its Gateway request provenance. The committed recorded configuration is
not a recording default. The recorder executes exactly two production calls in
production-step order. The recorder retains request hashes as observation
metadata but does not verify them against prompt text. It stages the exact
two-file directory on the
same filesystem, validates every record, replays that staged set through the
shared runner, and compares only the final main-story and announcements
products before promotion. Promotion is recoverable and all-or-none at the
directory level; it does not promise continuous visibility to concurrent
readers. A failed call, validation, staged replay, or comparison leaves the
previous committed set in place. Recording has no judge, score, threshold,
byte pin, or source-digest acceptance gate.

Current recorded-response version 3 artifacts retain the exact adapter, model,
optional per-step inference settings, and adapter-specific declarations for
each production step. Absent-version and version 2 responses keep their
historical meaning and remain parseable. Fixture authoring may omit or set each
inference field independently for every step; retained configuration is
evidence, not a replay instruction.

The model-evaluation command is a separate surface:
`benchmark run --fixture <path> --config <path> [--results-dir <path>]`. Its strict
benchmark declaration contains a nonempty ordered list of exact two-step live
configurations, a positive repetition count, and an explicit transport retry
limit from zero through three. Recorded adapters and duplicate configuration
identities reject before artifact creation. Historical run files keep their
existing directory, schema, and meaning. Configuration-order and
repetition-order roster members execute serially. Within each Evaluation Trial,
the main-story and announcements writers may dispatch concurrently. This is
application scheduling, not a promise that an underlying model runtime
processes the requests in parallel. The eval application owns this artifact
boundary directly, adding no third domain port and changing neither provider
adapters nor production Workflow scheduling.

Current live configurations emit Benchmark Run version 9. Historical version 8
Gateway records and older version 7 runs remain readable, and a
`cloudflare_ai_gateway` configuration still retains the
additional Gateway-request roster is allocated and resolved atomically beside
the invocation and runtime-evidence rosters. Current readers accept only versions
9 for new artifacts; versions 7 and 8 are historical readers only, and older
Benchmark Run formats are inert files and have no parser,
migration, prompt contract, or development gate.

The evaluation reference corpus is selected only through `corpus extract
--snapshot <sqlite-path> --selection <selection-path>` and `corpus show
--corpus <manifest-path>`. The committed selection declaration is content-free:
it admits only active-region ids and ordered half-open UTC windows and rejects
content selectors, author selectors, keywords, and message ids. Extraction
verifies the declared snapshot digest, copies the exact selection bytes,
replays the unchanged evidence-preparation path, and atomically publishes only
the copied snapshot, copied selection, and derived fixtures beneath the ignored
`apps/eval/local-data/corpus-workspaces/` root. It prints counts only and never
calls a model. Root privately authors the semantic references and one
selection-bound version 3 manifest inside that workspace. `corpus show
--corpus <manifest-path>` validates the manifest hash binding, closed workspace
membership, frozen selection roster, raw and prepared counts, and full declared
variation coverage before reporting the local corpus. Repository version 2
remains the historical Git-addressed synthetic corpus reader. Current V3 sparse
coverage is at most 13 prepared messages, with the sparse variation witness
roster exactly matching the full prepared-message roster; historical V2 sparse
remains frozen at at most 6. The full 13-region day remains a later local
stress corpus, not part of the current capability.

Loading runs every fixture through `EvidenceFixtureSchema` and the real
`prepareEvidence` path. Every cited identity and excerpt must survive under the
same message id. The current local V3 workspace and the historical committed V2
tree beneath the selected corpus path must each exactly match their manifest,
and strict contained POSIX paths prevent implicit selection or unowned
evidence. Dense/sparse thresholds,
event-time relationships, contradiction roles, unresolved records, grounded
names/numbers, announcement candidates, and explicit irrelevant-message ids
make variation tags auditable rather than decorative. Existing valid
single-fixture commands, artifacts, and outputs remain unchanged; no existing
namespace silently selects a corpus entry.

Evaluation scorecards are a separate eval-owned evidence boundary selected only
through `scorecard build --input <declaration-path> [--results-dir <path>]` and
`scorecard show <scorecard-id> [--results-dir <path>]`. A declaration binds one
exact configuration to the complete ordered reference corpus, every complete
current version 9 Benchmark Run for that corpus, exact Codex output
annotations, and separate Codex qualitative reviews. Historical version 7 and
Gateway version 8 Benchmark Runs remain readable inputs when explicitly
addressed. Version 1
human evidence retains its historical schema and is not rewritten. No Benchmark
Run, corpus entry, production prompt, retry policy, generation path, or
historical artifact is changed by scorecard construction, and this boundary adds
no domain port.

Scorecard artifact generations are distinct contracts: embedded V1 remains
historical, Git-addressed V2 remains historical, and current V3 stores local
hash-addressed declarations and evidence under the ignored
`apps/eval/local-data/scorecards` root. Current scorecard declarations and
explicit current results directories must stay contained under that root so the
local resolver can reject absolute paths, traversal, symlink escape, and SHA
mismatch. Current loads recompute every output identity, context identity,
count, rate, 95% Wilson interval, distribution, and qualitative summary before
accepting the artifact. Version 8 output identities and role contexts
additionally hash their exact Gateway-request records, while the source
descriptors retain the complete ordered Gateway-request hash roster. Current
scorecard V3 consumes the canonical current corpus V3, while repository version
2 remains a historical Git-addressed reader.
Current reports contain exactly two production-role sections: `main_story` and
`announcements`. Historical four-role scorecard families remain readable.
Deterministic measurements expose named units,
denominators, sample counts, and unavailable or inapplicable states. Semantic
grounding, attribution, event coverage, announcement relevance, coherence,
usefulness, newsworthiness, and voice remain visibly Codex-authored evidence.
There is no weighted or combined score, model rank, winner, threshold,
recommendation, acceptance verdict, retry trigger, or production selection.
The corpus source reference is normalized to the last commit that changed its
closed corpus subtree, so later evidence-storage commits do not manufacture a
context change; a real corpus revision changes that explicit commit-and-path
identity. Public readers continue to dispatch and reconstruct frozen version 1
embedded-source artifacts without adding byte ownership to version 2.

Aggregate evaluation results remain inside that same eval-owned filesystem
boundary and add no domain port. `aggregate export --input
<scorecard-artifact-path> --cohort <cohort-id> [--results-dir <path>]` reads a
current local detailed scorecard from `apps/eval/local-data/`, binds one
validated export to its exact corpus identity, and requires the mandatory
`--cohort` value to equal that validated source scorecard identity. The result
is then stored under `apps/eval/summaries/` by default. `aggregate show <aggregate-id>
[--results-dir <path>]` and `aggregate compare <left-id> <right-id>
[--results-dir <path>]` reopen and compare those aggregate files. Export is a
whitelist projection, never a redaction pass over a full scorecard: each role
retains only the model subject descriptor, counts, rates with intervals,
aggregate distributions, and qualitative counts. It excludes source or
model-output evidence, repository or filesystem paths, hashes, context
identities, sample-level records, and qualitative rationales. The result stays
descriptive and evaluation-only; it adds no score, winner, rank,
recommendation, acceptance verdict, production selection, walk phase, or third
domain port, and it does not participate in acceptance or skeleton-walk
verification. Aggregate V2 remains content-free and binds
`cohort.evidence_identity_sha256` to the source corpus identity.

Longitudinal evaluation remains inside that same eval-owned filesystem evidence
boundary and adds no domain port. `longitudinal build --input
<declaration-path> [--results-dir <path>]` consumes an ordered current local
declaration under `apps/eval/local-data/`, while embedded V1 and Git-addressed
V2 remain historical reader contracts. `longitudinal show <series-id>
[--results-dir <path>]` reloads both current local and explicit legacy
directories through the existing dispatch roots. Current V3 series are local
hash-addressed rather than byte-embedded, and their declarations plus explicit
current results directories must stay contained under
`apps/eval/local-data/longitudinal-scorecards` so the local resolver can reject
escape or tampering. Underlying Benchmark Run ids are pairwise disjoint, so a
repackaged scorecard cannot manufacture repetitions.

Each production role owns a separate stable longitudinal cohort projection.
It retains corpus/reference and prepared-evidence identities, ordered prompt
hashes normalized away from generated run/trial locators, output-contract and
exact code provenance, exact role adapter/model/sampling configuration,
declared transport retry policy, and normalized execution context. Generated
ids and timestamps, realized retry attempts, outputs, Codex assessments,
tokens, latency, and volatile prediction observations remain behavior. Exact
context mismatch produces `context_changed`; unknown context, fewer than three
baseline packs, fewer than two later packs, or no eligible quantitative metric
produces `insufficient_evidence`.

Only an unchanged sufficiently observed cohort reaches quantitative signal
inspection. Rate histories pool numerators and denominators and recompute 95%
Wilson intervals; strict interval disjointness is a named signal. Tokens and
each application/provider latency dimension retain separate raw descriptive
distributions; strict observed-range disjointness is a named signal. At least
one signal yields `potential_drift`, otherwise the role is `within_baseline`.
Categorical qualitative histories retain reviewer and rubric evidence but do
not drive the classifier. The rule deliberately makes exact corpus-source or
evaluated-code commit changes new context, treats variable writer output as
request context when a measured surface retains it, and
exposes correlation, range-extreme, multiplicity, evaluator-variation, and
non-causality limits. It adds no overall score, judge, rank, recommendation,
quality threshold, verdict, retry action, publication decision, or production
selection.

Scorecard and longitudinal reports separately compare every evaluated code
commit with the explicitly resolved repository-root `HEAD`. `current` and
`outdated` are information only. A different checkout commit never rejects a
source reference, prevents reconstruction, blocks a build/show command, or
decides whether another evaluation may run.

Current Benchmark Run version 9 is the active contract. It retains each
role's exact adapter configuration, diagnostics, invocation lifecycle, and
normalized runtime evidence. Historical version 8 is the Gateway contract and
historical version 7 is the pre-Gateway contract; both remain readable and are
not migrated in place. Current readers emit only version 9 artifacts. All
three readable families expose the same four subject outcomes: `completed`, `parse_rejected`,
`contract_rejected`, and `infrastructure_incomplete`.

One ordered application owner creates the run in `running` state before
transport, allocates invocation ordinals, and applies every current V9
transition. It atomically retains each request, configuration identity,
invocation state, runtime-evidence state, and, for Gateway-backed historical
or current records, the Gateway-request state.
Concurrent editorial tracks therefore enter one monotonic interleaved history
without concurrent authoritative-file replacement. Eligible retries link to the
immediately preceding same-step failure and preserve the request; deterministic
failures never retry. Both tracks quiesce before terminal aggregation, while a
validation, persistence, or unknown harness failure leaves the last strict
running artifact inspectable rather than claiming retained completion.

Runtime evidence uses application-owned `observed`, `unknown`, or
`externally_controlled` states instead of retaining raw provider configuration or
inventing missing values. Comparable execution context remains separate from
volatile prediction observations. The [test and verification
posture](TESTING.md) owns the exact lifecycle invariants, verifier observations,
and corruption cases that prove this structure.

The current V9 roster follows declared configuration order and repetition
order. Trials form an append-only prefix, only the final retained trial may be
running, terminal predecessors are immutable, and a benchmark becomes retained
only after every declared trial is terminal. A track-local subject rejection or
provider exhaustion does not suppress its sibling or later serial roster
members. Invalid state or failed persistence stops coordination.

Retained Benchmark Runs are browsed through `benchmark list`, `benchmark show`,
`benchmark summary`, and `benchmark compare`; strict reads bind filename to
artifact identity and reject corrupt evidence. Recorded-replay Run Files remain
a distinct contract under `apps/eval/local-data/acceptance-results` by default,
owned only by the `acceptance` routes. They are never relabeled as Benchmark
Runs. Comparison keeps exact evidence, configuration, retry policy, provenance,
and execution context separate from lifecycle, outputs, failures, usage,
billing, duration, retry relationships, and prediction observations. It
owns no score, judge, recommendation, or acceptance decision.

Main-story and announcements evaluation tracks dispatch concurrently and
execute independently as two track-local writer calls. A rejection or exhausted
provider in one does not suppress the other, and both tracks quiesce before
terminal aggregation. Preservation and final-product findings are deterministic
diagnostics attributed to writer output; a schema-valid product completes its
track with those diagnostics retained. Subject outcome describes model behavior, while harness outcome states
only whether trustworthy evidence was retained. Current validation protects
structure, identity, lifecycle, provenance, retry linkage, and evidence rosters.
It does not reconstruct prompt text, reparse retained completions, or preserve
the semantics or loadability of old artifact formats.

Evaluation code provenance is exactly `repository: bc-news`, a validated
40-character commit SHA, and `dirty: false`. Evaluation starts only from that
clean commit; no second unbound workspace digest competes with the commit
identity.

Model evaluation declarations assign an exact configuration to every role and
may vary model and adapter-specific inference settings independently across
those roles. Omitting one inference field for one role includes that field's
provider default as a candidate without affecting any other role or field.
Declarations retain repetition and transport retry limits as run-level
experiment and infrastructure controls. Results are
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
project exists. Static assets and dynamic Worker responses share an explicit
browser policy: same-origin scripts, connections, and fonts; Chakra-compatible
inline styles; same-origin or data-URI images; no object, worker, form, or frame
capability; no referrer; no content sniffing; and no framing. The policy adds
no CORS surface. The only operator HTTP routes are exact `POST /generation-run`
and exact `GET /generation-run`; both require a bearer token held in the
`OPERATOR_API_TOKEN` Worker secret, return non-cacheable responses, and fail
closed when that secret is absent. Pair-addressed status is the complete
operator read contract; opaque Workflow-id paths are ordinary unknown routes.
A second Worker now exists — ingest — but it serves no
client or reader traffic: it exposes only its own poll endpoint, binds the
same D1 database as the generation Worker, and carries no static assets, so
the client and `/api/edition` remain exactly the single-origin surface this
paragraph describes. The client validates at its boundary
like every other seam: `/api/edition` responses parse with the shared
edition schema and the identity pair arrives only via URL query — missing
or invalid identity renders the explicit no-published-edition state, never
a fixture default baked into client code.

Settled — repository-owned production prerequisites: both Worker
configurations explicitly disable `workers.dev` and preview URLs rather than
inheriting Wrangler defaults. Generation gains its intended public hostname
only through an explicitly configured custom domain; repository inspection does
not establish that deployment. Ingest has
no `route`, `routes`, or static assets. Its source-level unauthenticated `POST
/poll` handler remains reachable to the local composed walk, but the checked-in
production configuration gives it no public hostname; scheduled invocation is
the only configured production entrypoint. A future public route would require
a separate protection boundary. Generation declares exactly
`OPERATOR_API_TOKEN` under Wrangler's required-secret metadata and never under
plain-text `vars`. That declaration supports types and local missing-secret
warnings; it does not install or prove the Cloudflare secret.

Both checked-in Worker configurations name the same concrete D1 database and
database id. Repository proof is deliberately limited to one nonblank matching
`DB` identity, generation-only migration ownership, static prepared SQL with
bound parameters, validated stored JSON, and the absence of any raw-chat reader
route. It does not establish that the configured id exists remotely, that the
binding is deployed, or that the migration chain has run against it.

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
It first proves the operator boundary with a walk-owned local token:
unauthenticated launch and pair status are rejected without creating a run,
authenticated launch and pair status succeed, and opaque Workflow-id paths
remain absent with or without credentials. It then dispatches the generation
Worker's real local scheduled event at
the fixture publication instant, observes all 13 deterministic Workflow
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

The walk observes the security policy on the served HTML and on successful and
absent edition JSON responses. Its installed-Chrome pass is the compatibility
proof that the CSP still permits the real React/Chakra newspaper while its
existing page-error, console-error, failed-request, and external-origin gates
remain strict.

The same walk uses authenticated
`GET /generation-run?active_region_id=...&publication_date=...` as the operator
surface rather than exposing an opaque Workflow id. It proves
the absent-evidence pair reaches a structured prepare-evidence failure with no
model usage, and proves region 7 reaches complete with all five ordered
generation steps and exactly one recorded-replay usage record for each of the
two production model steps, each with unavailable token measurement and zero
external billing. It strictly observes writer-only diagnostics on the
representative schema-valid output, then proves deterministic assembly serves
those writer products. Repeated
scheduled delivery must leave edition bytes, retained usage, and retained
diagnostics unchanged. The walk does not invoke evaluation, fixture-authoring,
context, or recorded-replay acceptance verifiers. It owns only its composed
product observations and terminal `WALK PASS`; the exact successful observations
from those direct verifiers must not appear in walk output.

Recorded-replay acceptance executes the two production model steps twice
against explicitly selected committed replay fixtures, then reloads its distinct
Run File contract. It proves deterministic replay by re-execution, not by
comparing current behavior with a stored expected Run File, and it remains
separate from live model evaluation and its ignored local evidence. Current Run
Files retain diagnostics; historical readers preserve the older unknown state
when that field is absent. This acceptance boundary has no model judge, quality
threshold, byte pin, or source-digest gate. The [test and verification
posture](TESTING.md) owns its exact assertions, commands, and terminal
observation.

Exact context-budget measurement is invoked as `context benchmark --fixture
<path> [--results-dir <path>]`. It is eval tooling, not a production port.
It reuses the production prompt builders, strict structured-output contracts,
and pure LM Studio request builder, while an eval-local SDK runtime only lists
the loaded LLM, applies its chat template, counts with its tokenizer, and reads
its configured context length. The live command requires exactly one loaded
Qwen model and the same model id across both production-step configs; it
never loads, switches, unloads, or contacts a hosted model.

Current context-result version 3 artifacts retain the exact two independent LM
Studio production-step configurations, including optional `temperature`,
`top_p`, `top_k`, and `enable_thinking`. Version 2 and absent-version context
results retain their historical meanings. The command requires one loaded model
because it measures one runtime context, but each role still retains and uses
its own inference choices.

The representative evidence corpus produces 208 prepared messages under the
unchanged evidence-message sampler, so its fixed measurement matrix is 1, 50,
100, 150, and 208.
Each load preserves the retained message order and builds both writer requests
from the prepared evidence. Provider-reported usage is reconciled
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
Workflow observation; no id-addressed diagnostic route exists.

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
synthetic edition for it. Midnight is the generation schedule and publication
date boundary, not the reader-facing availability promise. The client describes
today's absent edition as expected by 10:00 UTC, keeps that state in the waiting
window through 10:29 UTC, and reclassifies it as failed at the 10:30 UTC cutoff.

## Links

- [Product requirements](PRD.md) — the constraints this posture serves.
- [Domain model](DOMAIN.md) — the vocabulary these structures implement.
- [Test and verification posture](TESTING.md) — owns the commands, evidence
  contracts, and success observations that prove this structure.
- [v1 reference map](v1-reference.md) — the prior art and the failure
  modes this discipline is designed against.
