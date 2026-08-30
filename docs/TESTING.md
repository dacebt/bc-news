---
type: doc
title: >-
  bc-news test and verification posture
description: >-
  The binding evidence discipline for bc-news v2 — what proves a change works, how model evidence is retained and measured, and what recorded replay accepts.
tags: [documentation, testing, verification, evaluation]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:55:35Z"
authority: binding
---

# bc-news test and verification posture

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. Build
agents in this repo operate under the WSD standards discipline; this document
binds how that discipline's evidence domains apply to *this* project, so
"write a test" means one thing across every session.

## Separate verification domains

These surfaces answer different questions. None inherits another surface's
outcome or silently substitutes for it. There are ten runtime evidence owners;
TypeScript and lint are supporting static guarantees, not an eleventh result.

| Domain | Command | Evidence | Outcome |
|---|---|---|---|
| Deterministic tests | `pnpm test` | Isolated warranted invariants, reproduced defects, and high-risk state transitions | Test pass or hard test failure; never a retained model attempt |
| Scratch model run | `scratch run` | One live two-writer production pass saved only to an explicitly selected results directory | Development inspection artifact; never a Benchmark Run, scorecard source, baseline, or acceptance verdict |
| Model evaluation | `benchmark run/list/show/summary/compare` | Strict versioned Benchmark Runs under `apps/eval/local-data/evaluation-results` by default | Retained model subject and harness outcomes with `evaluation:` observations; never a score or acceptance verdict |
| Evaluation reference corpus | `corpus extract --snapshot <sqlite-path> --selection <selection-path>`, `corpus show --corpus <manifest-path>`, and direct verifiers | Current local V3 selection-bound corpus workspaces under `apps/eval/local-data/corpus-workspaces/` plus historical Git-addressed V2 synthetic readers | Auditable source truth and objective variation coverage; never a model result, score, or acceptance verdict |
| Evaluation scorecards | `scorecard build/show` and `verify:evaluation-scorecards` | Current local hash-addressed scorecards under `apps/eval/local-data/scorecards` by default, plus embedded V1 and Git-addressed V2 historical readers | Two transparent current-role measurements plus current/outdated checkout information; historical four-role families remain readable; never an aggregate score, ranking, recommendation, or acceptance verdict |
| Aggregate evaluation results | `aggregate export/show/compare` and `verify:evaluation-aggregate-results` | Strict content-free aggregate JSON under `apps/eval/summaries/` by default, with `cohort.evidence_identity_sha256` bound to the source corpus identity | Descriptive role aggregates only: subject descriptor, counts, rates and intervals, aggregate distributions, and qualitative counts; never source or model-output evidence, a winner, a rank, a recommendation, acceptance, or production selection |
| Longitudinal evaluation scorecards | `longitudinal build/show` and `verify:evaluation-longitudinal-scorecards` | Current local hash-addressed series under `apps/eval/local-data/longitudinal-scorecards` by default, plus embedded V1 and Git-addressed V2 historical readers | Four role-specific context, sufficiency, baseline-variation, or potential-drift observations; never a judge or product gate |
| Fixture and context tooling | `fixture record-responses` and `context benchmark` | Two step-keyed recorded responses, or strict context results | Fixture-authoring or context-measurement tooling result; never acceptance or a walk |
| Recorded-replay acceptance | `acceptance run/list/show/compare` and its direct verifier | Current local Run Files under `apps/eval/local-data/acceptance-results` by default, plus historical readers when explicitly addressed | `acceptance:` result over controlled replay; never a Benchmark Run outcome |
| Composed skeleton walk | `pnpm walk` | The running local ingest, generation, persistence, API, status, and browser product | Walk-owned `walk:` observations followed by independent terminal `WALK PASS` |

Committed recorded responses and conversation fixtures are controlled replay
inputs for tests, fixture-backed acceptance, and the composed walk; they are not
retained live-model evaluation evidence. Current detailed corpus workspaces,
Benchmark Runs, scorecards, and longitudinal series stay under the ignored
`apps/eval/local-data/` root. Only the content-free selection declaration and
whitelist-only aggregate summaries are commit-eligible current evaluation
records. Historical readers keep prior committed formats readable without
turning them into current evidence. The `packages/fixtures` package-root
shorthand stays pinned to the representative full-evidence fixture; replay work
that depends on the focused coordinate-token corpus must pass the explicit
`packages/fixtures/evidence/game-reference-links.json` path instead.

**Deterministic tests** protect warranted invariants, reproduced defects, and
high-risk state transitions. A failing test is a hard failed test; it is not a
retained model-evaluation attempt.

**Scratch model runs** use `scratch run --fixture <path> --config <path>
--results-dir <path>` to execute the current two-writer production path against
local or hosted models while prompts and configurations are still changing.
The caller must choose the results directory; use a path under `/tmp` for
disposable comparisons. Hosted requests receive run and invocation correlation.
Scratch runs do not require a clean worktree, use a frozen Benchmark Run
contract, enter the retained evaluation-results directory, establish a
baseline, or supply scorecard or acceptance evidence.

**Model evaluation** uses `benchmark run --fixture <path> --config <path>
[--results-dir <path>]` to observe an ordered configuration and repetition
roster serially. Within each Evaluation Trial, the main-story and announcements
writers may dispatch concurrently. One ordered application owner allocates invocations and
applies every retained current transition, retaining each invocation and its
pending runtime-evidence record before provider transport. This produces one
truthful interleaved history while the artifact store's atomic full-file
replacement never races. Its strict Benchmark
Run retains every reached Step Invocation before transport and before parsing.
Malformed JSON, strict schema mismatch, and infrastructure-incomplete execution
are distinct typed subject outcomes and can coexist with `harness_outcome:
retained`; invalid configuration or an untrustworthy create, write, reparse, or
unknown harness rejection stops without terminal retained completion.
Evaluation reports behavior, provenance, and deterministic findings without a
judge, score, or acceptance verdict. Eligible transport failures receive only
the declared bounded retries, with each attempt retained and linked. Provider
exhaustion or schema rejection closes its dependent track without suppressing
the independent editorial track or later declared trials. Provider
response-contract rejection retains and prints sanitized schema issue paths,
codes, expected types, and received structural types without retaining rejected
values. A provider-reported explicit null completion instead retains successful
transport, usage, provenance, and runtime evidence, then becomes a strict
schema-mismatch model-output rejection in historical Gateway artifact version
8. Historical non-Gateway version 7 artifacts required textual completion
content. Both tracks quiesce before terminal aggregation; interruption leaves a
strict running current version 9 artifact, while historical version 7 and
Gateway-only version 8
artifact browseable through `benchmark list`, `benchmark show`, `benchmark
summary`, and `benchmark compare`. Concurrent dispatch proves harness
scheduling, not parallel processing inside a selected model runtime. Comparison
separates fixture, configuration, and provenance context from behavior and
reports no score, judge result, recommendation, or acceptance decision.

Current Benchmark Run version 9 retains existing live configurations.
Historical version 7 and Gateway version 8 artifacts remain readable. A
`cloudflare_ai_gateway` configuration additionally requires
one lifecycle-matched Gateway-request record for every invocation, including
the response-scoped log id and declared cache/logging/retry/timeout policy on
success. New Gateway records additionally retain the exact model-profile
request format, response-delivery mode, and structured-output contract name.
Gemini Chat Completions and Luna Responses are both strict Gateway paths:
Luna retains the routed `openai/gpt-5.6-luna` request id, the returned
`gpt-5.6-luna` response model, and only a `completed` Responses envelope whose
`output` contains zero or more `reasoning` items plus exactly one completed
assistant message with one or more nonblank `output_text` items. Both current
paths retain bounded structured provider-error
details for deterministic Gateway HTTP rejections so an infrastructure failure
identifies the rejected parameter and provider reason rather than only the
status code. OpenAI request profiles prove that every wire property is required,
canonical optional properties are nullable, and returned null placeholders
normalize back to the canonical optional shape. Both current paths
retain every exact per-role configuration, schema-valid writer diagnostic,
and a lifecycle-matched runtime-evidence record for every invocation. Each role
independently chooses a provider, model, and adapter-specific inference
settings. For LM Studio, `temperature`, `top_p`, `top_k`, and
`enable_thinking` are independently optional; omission includes that field's
provider default as a candidate. LM Studio and profiled Gateway models
receive the same strict production-step JSON Schema, while each Gateway model
profile owns its provider request encoding. Model evaluation compares these
candidate configurations to select production settings; it is not a
deterministic test or a provider-default quality gate.
Current version 9, historical version 8, and historical version 7 preserve the
same four subject outcomes: `completed`,
`parse_rejected`, `contract_rejected`, and
`infrastructure_incomplete`. Runtime evidence separates comparable execution
context from volatile prediction observation and represents every unavailable
field as an explicit unknown or externally controlled state.

Malformed JSON or strict schema mismatch is the only terminal model-output
failure. Infrastructure failure is classified separately. Every schema-valid
grammar, punctuation, markdown, wording, preservation, or editorial-policy
finding is retained as a non-terminal diagnostic on writer output and
never causes another model call, rejection, or publication stop.

**Fixture and context tooling** owns two different development artifacts.
`fixture record-responses --fixture <path> --config <path> [--response-dir
<path>]` accepts only `lmstudio` and `openai_compatible_hosted` production-step
adapters and writes the exact two step-keyed response files only after staged
replay and comparison. The `recorded` adapter rejects because it is not live;
`cloudflare_ai_gateway` rejects because the current recorder format cannot
retain its Gateway request provenance. `context benchmark --fixture <path> [--results-dir
<path>]` writes strict context-measurement results. Neither tool creates a
Benchmark Run or Run File and neither confers acceptance.
Current recorded-response version 3 and context-result version 3 artifacts
retain every exact per-step configuration and optional LM Studio inference
setting. Historical versions keep their original meanings. Either tool may
independently omit or set `temperature`, `top_p`, `top_k`, and
`enable_thinking` for each LM Studio step; the declaration, not the command
name, determines the experiment.

**The evaluation reference corpus** is a deterministic input-evidence domain,
not a model evaluation result. `corpus extract --snapshot <sqlite-path>
--selection <selection-path>` admits only a content-free committed declaration
of active-region ids and ordered half-open UTC windows. Content selectors,
author selectors, keywords, and message-id selectors are rejected. Extraction
verifies the declared snapshot digest, copies the exact selection bytes,
replays the unchanged preparation path, and atomically publishes only the
copied snapshot, copied selection, and derived fixtures beneath the ignored
`apps/eval/local-data/corpus-workspaces/` root. It prints counts only and
never emits production chat or calls a model. Root privately authors the
semantic references and the selection-bound version 3 manifest inside that
workspace. `corpus show --corpus <manifest-path>` then validates the manifest
hash binding, closed workspace membership, frozen selection roster, raw and
prepared counts, and full declared variation coverage before reporting the
current local corpus. The current scorecard V3 flow consumes that canonical
current corpus V3. Repository version 2 remains the historical Git-addressed
synthetic corpus reader. Current V3 sparse coverage is at most 13 prepared
messages, with the sparse variation witness roster exactly matching the full
prepared-message roster; historical V2 sparse remains frozen at at most 6. The
full 13-region day remains a later local stress corpus, not part of this
capability.

**Evaluation scorecards** consume, but never alter, complete retained current
version 9 Benchmark Runs and the full ordered reference corpus. Historical
version 7 and Gateway version 8 Benchmark Runs remain readable inputs when
explicitly addressed. A Gateway-backed output identity requires the hash of its
exact Gateway-request record,
and identified role context retains the ordered request-record hashes without
turning response-scoped log ids into stable longitudinal context. `scorecard
build --input <declaration-path> [--results-dir <path>]` requires one exact
configuration, every corpus fixture in order, every selected trial and invocation
attempt, exact source-linked Codex annotations for every parse-success output,
and a separate exact Codex qualitative review for every such output. `scorecard show
<scorecard-id> [--results-dir <path>]` reloads current V3 declarations and
named evidence through the contained local resolver, while historical V2
artifacts remain Git-addressed readers. It then recomputes the artifact before
reporting it. Current scorecard V3 artifacts consume the canonical current corpus V3,
while repository version 2 remains a historical Git-addressed reader. Version
1 human evidence retains
its frozen historical contract and remains readable through the public store
and report path. Current declarations and explicit current results directories
must stay contained under the ignored `apps/eval/local-data/` root, where V3
artifacts use SHA-256-bound contained relative references instead of embedded
raw bytes. Embedded V1 and Git-addressed V2 remain historical readers.

The two current production roles remain separate. Rates expose their exact numerator,
denominator, denominator unit, sample count, comparable-context identity, and a
95% Wilson score interval. Token usage, application latency, and provider timing
remain separate descriptive distributions, with unavailable observations never
converted to zero. Coherence, usefulness, newsworthiness, and voice remain
nonnumeric Codex assessments with reviewer identity, rationale, and uncertainty.
Grounding, attribution, event coverage, and announcement relevance likewise
retain the Codex annotation that supplies their semantic classification. These
transparent named measurements are not a weighted overall score, automatic
judge, model ranking, recommendation, quality threshold, acceptance verdict,
retry trigger, or production-selection decision.

The current version 2 qualitative rubric uses these fixed meanings: `coherence` is
internally understandable organization and relationships; `usefulness` is
useful source-grounded information for a regional reader; `newsworthiness` is
the Codex assessment that included material is worth reporting without requiring
one target angle; and `voice` is adherence to the declared in-world,
straightforward editorial voice.

**Aggregate evaluation results** are exported only from a current validated
local scorecard artifact via `aggregate export --input <scorecard-artifact-path> --cohort
<cohort-id> [--results-dir <path>]`, where the mandatory `--cohort` value must
exactly match the validated source scorecard corpus id. They are then
reopened through `aggregate show <aggregate-id> [--results-dir <path>]` and
compared through `aggregate compare <left-id> <right-id> [--results-dir
<path>]`. Without `--results-dir`, they live under `apps/eval/summaries/`.
Export is a whitelist projection, not a redaction pass: each role retains only
the model subject descriptor, counts, rates with intervals, aggregate
distributions, and qualitative counts. Source or model-output evidence,
repository or filesystem paths, hashes, context identities, sample-level
records, and qualitative rationales are excluded by contract. This surface
remains evaluation-only and descriptive; it does not create a score, winner,
rank, recommendation, acceptance gate, production decision, or walk result, and
it is not part of acceptance or skeleton-walk evidence. Aggregate V2 remains
content-free and binds `cohort.evidence_identity_sha256` to the validated
source corpus identity.

**Longitudinal evaluation scorecards** consume exact scorecard audit packs
without rewriting historical version 1 evidence. `longitudinal build
--input <declaration-path> [--results-dir <path>]` requires ordered, unique,
contained current local declarations and pairwise-disjoint underlying Benchmark
Run ids. Baseline packs are all earlier than subject packs. `longitudinal
show <series-id> [--results-dir <path>]` reloads every referenced scorecard through
the existing public reader and recomputes all cohorts, histories, statistics,
and classifications. The public reader also dispatches frozen embedded V1 and
Git-addressed V2 audit packs through their historical reconstruction/report
paths. Default current artifacts live under
`apps/eval/local-data/longitudinal-scorecards`; only `apps/eval/summaries/`
remains commit-eligible.

Classification is per production role and follows fixed precedence. Any exact
stable-context mismatch is `context_changed`. Unknown context, fewer than three
baseline packs, fewer than two subject packs, or no eligible quantitative
measurement is `insufficient_evidence`. Only an unchanged sufficiently observed
cohort can be `potential_drift` when a named quantitative witness is strictly
separated, or `within_baseline` otherwise. Rates pool exact numerators and
denominators and compare recomputed 95% Wilson intervals. Tokens and every
latency metric remain separate raw distributions and compare strict observed
ranges. Not-applicable and unavailable values never become zero. Codex
qualitative histories remain categorical and descriptive and do not drive the
classifier.

These four labels are model-evaluation observations only. They do not establish
causality, equivalence, editorial quality, model rank, recommendation, retry,
acceptance, or production action. Writer output identity remains part of the
measured context. Counted units can be correlated, baseline extremes can mask range
movement, multiple named metrics raise multiplicity risk, and Codex annotations
or reviews can vary without proving model drift.

Freshness is separate from cohort comparison and artifact validity. Build and
show compare each evaluated code commit with the explicitly resolved repository
root's `HEAD` and report `current` or `outdated`. A different commit is never a
failure, rejection, acceptance gate, or reason to prevent another evaluation.

**Recorded-replay acceptance** uses `acceptance run --fixture <path> [--config
<path>] [--results-dir <path>]` and `acceptance list/show/compare`. It executes
the two production model steps twice. Results must be identical apart from
run identity and timestamps, carry the exact ordered roster and usage, match
parsed recorded responses, recompute request relations from the requests
actually built, and assemble the final edition from the two writer
products. When the committed replay responses carry focused game-reference
tokens, acceptance must use the dedicated focused fixture that grounds those
tokens rather than the representative package-root shorthand. This is an
explicit acceptance gate over controlled evidence, not a
live model evaluation. Its artifact is a distinct Run File, not a Benchmark
Run. Current Run Files require exact ordered diagnostics; historical files
without the field report diagnostics as unknown, never as observed empty.

**The composed skeleton walk** runs a fixed local conversation through the whole
pipeline: ingest into a fresh isolated D1 database; the real scheduled
generation Workflow; `main_story_write` and `announcements_write`; deterministic validation,
assembly, and publication; the operator status projection; API read; and the
published/unavailable/Back reader experience in installed Chrome. It uses
exactly two recorded responses and no production data, live model, paid
service, or external origin. The status proof requires all five generation
steps in order, exactly two ordered recorded-replay usage records at zero
external billing, and writer-only diagnostics from the representative
schema-valid output. A fixed walk-only bearer token is injected into local
Wrangler: unauthenticated launch and pair status must be rejected without a
created run, authenticated launch and pair status must succeed, and opaque
Workflow-id paths must remain generic 404s with or without credentials. The
served edition must equal the two writer products,
derive writer-only provenance from those two usages, and contain
no internal announcement ids. The same walk must also prove the exact retained
`game_references` roster, two truthful focused-map links for the named and bare
displays of the same coordinate, and no active anchor for an arbitrary
Markdown URL. Duplicate delivery must preserve edition bytes
and usage, and an unknown pair must remain absent. The main document and both
successful and absent edition responses must carry the declared CSP, framing,
content-type, referrer, and permissions policy; successful editions additionally
declare the public browser/edge TTL, while absent responses are non-cacheable.
The real Chrome page must remain free of CSP-caused page, console, request, or
origin failures. Browser traffic is
same-origin-only and exactly two pair-addressed edition 404s are allowed. This
is the [PRD](PRD.md)'s first success signal and proves the composed deployable
product. It does not invoke the evaluation, fixture-authoring, context, or
acceptance verifiers. A passing test, retained Evaluation Trial, tooling result,
or acceptance gate cannot replace its own `WALK PASS`.

**Static guarantees** support every domain. Strict TypeScript, lint, and zod
contracts parse-and-reject at every boundary; they do not prove runtime
behavior. The production-configuration contract semantically parses both real
Wrangler JSONC files and locks alternate-origin disablement, ingest route
absence, named-environment absence, dashboard-variable preservation, the exact
required-secret declaration without a plain-text secret, the selected
production model configuration, and the single shared D1 binding with
generation-only migration ownership. Together with disabled `workers.dev` and
preview URLs, the ingest Worker's missing `route`, `routes`, and assets prove
that its source-level `POST /poll` handler has no checked-in public hostname;
they do not prove remote dashboard state. The D1 check proves only one nonblank,
matching configured database name and id, not remote existence, deployed
binding state, or applied migrations.
Both the production-dependency and full dependency audits must report zero
current advisories.

## Direct verification sequence

Run domain proofs independently, then the ordinary repository gates, then the
composed walk:

```sh
pnpm --filter @bc-news/eval verify:evaluation-trial-retention
pnpm --filter @bc-news/eval verify:evaluation-benchmark-continuation
pnpm --filter @bc-news/eval verify:evaluation-browse
pnpm --filter @bc-news/eval verify:benchmark-runtime-evidence
pnpm --filter @bc-news/eval verify:evaluation-reference-corpus
pnpm --filter @bc-news/eval verify:evaluation-corpus-extraction
pnpm --filter @bc-news/eval verify:evaluation-scorecards
pnpm --filter @bc-news/eval verify:evaluation-aggregate-results
pnpm --filter @bc-news/eval verify:evaluation-longitudinal-scorecards
pnpm --filter @bc-news/eval verify:recorded-response-fixture-authoring
pnpm --filter @bc-news/eval verify:recorded-replay-acceptance
pnpm audit --prod
pnpm audit
pnpm test
pnpm typecheck
pnpm lint
pnpm walk --non-interactive
```

The command-contract tests additionally exercise every namespaced CLI route,
option ownership, namespace-specific failure prefix, and rejection of the old
bare `evaluate`, `run`, `record`, `context`, `list`, `show`, and `compare`
routes. After a namespace is recognized, failures begin with `benchmark
failed:`, `scratch failed:`, `acceptance failed:`, `fixture authoring failed:`, `context
benchmark failed:`, `corpus failed:`, `scorecard failed:`, `aggregate
failed:`, or `longitudinal scorecard failed:`. Failures before namespace recognition begin with `command
failed:`; `eval failed:` is forbidden.

The benchmark-path verifiers print `evaluation:` observations. Trial retention
ends with `evaluation: concurrent tracks retained interleaved
progress, diagnostics, schema rejection, infrastructure failure, interruption
evidence, and completion`, continuation ends with
`evaluation: serial benchmark retained
linked retries and continued later trials`, and browsing ends with `evaluation:
evidence listed summarized and compared without verdicts`. Runtime-evidence
verification exercises the real
command, store, reader, projection, and summary path with controlled providers
and ends exactly with `BENCHMARK RUNTIME EVIDENCE VERIFIED`. Reference-corpus
verification loads the generated synthetic historical V2 repository proof
through the historical production reader, runs the complete corruption matrix,
and ends exactly with `EVALUATION REFERENCE
CORPUS VERIFIED`. Corpus-extraction verification exercises successful private
snapshot extraction, staging and cleanup, strict timestamp filtering, selected
snapshot isolation, rejection paths, and non-leaking failure output before
ending exactly with `EVALUATION CORPUS EXTRACTION VERIFIED`. Scorecard verification assembles controlled complete version
7 runs for the generated synthetic historical V2 repository proof through the
real input, builder, store, reader, report, and CLI paths; proves the exact
counts, contexts, rates, intervals, distributions, Codex-evidence linkage,
historical Git-path resolution, non-blocking outdated reporting, and semantic
corruption checks; and ends exactly
with `EVALUATION SCORECARDS VERIFIED`. Aggregate-result verification exercises
the real export, store, show, and compare paths against controlled scorecards,
proves the exact subject descriptor, counts, rates, intervals, distributions,
and qualitative-count projection, and rejects any forbidden source, path, hash,
context, sample, or rationale field that escapes the whitelist. Longitudinal
verification creates a
compact committed 3+2 audit pack and independently recomputes stable cohort
normalization, pooled rates, Wilson intervals, raw token/latency distributions,
two current-role classifications, with historical four-role families remaining
readable, plus store/read/report/CLI behavior, commit-backed
reopen, and outdated reporting, then ends exactly with
`EVALUATION LONGITUDINAL SCORECARDS VERIFIED`. Fixture proof ends
with `fixture authoring: two strict v3 hosted responses retained exact
production-step configurations, replayed, and compared`. Acceptance proof ends with `acceptance: four
recorded production steps replayed by step and deterministic; writer
diagnostics retained`. The composed walk prints none
of those exact verifier observations; it ends with its independent `WALK PASS`.

## What isolated tests defend here

Write one only when it earns its place:

- **Domain invariants** — the identity rules in the
  [domain model](DOMAIN.md): one region + date → one edition, no duplicate
  publication on retry, isolation of regional failure.
- **Date and window arithmetic** — publication-date and evidence-window
  logic; v1's calendar-date rejection lessons carry forward. Reader timing
  distinguishes the 00:00 UTC generation schedule, the 10:00 UTC expected
  availability target, and the 10:30 UTC cutoff where a still-absent current-day
  edition becomes a failure.
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
- **A guard needs a reference independent of the thing it checks.** An
  assertion that recomputes both sides from the same input is a tautology
  however many layers separate them: it holds for every possible edit to that
  input and proves nothing. Relations recomputed from what the run consumed
  and produced are the right shape for the run's *own* fields.
- **Recorded artifacts are inputs, not prompt contracts.** A retained
  `prompt_sha256` describes the request observed when a response was recorded;
  it is not compared with current prompt bytes by the recorded provider and is
  not a development gate. Prompt changes do not require editing or regenerating
  old response artifacts.
- **Over-broad source digests are provenance, not gates.** Source fingerprints,
  `code_version`, and retained run-file bytes may remain comparison evidence,
  but never become acceptance pins. A guard that fires because unrelated source
  text moved carries no useful product information.
- Determinism is proved by re-executing recorded-replay acceptance rather than
  against a stored file. Its comparison reports every differing field except
  `id`, `started_at`, and `completed_at`.
- Current Benchmark Runs validate only as version 9. Historical versions 7 and
  8 remain readable. Versions 1 through 6 have no active schemas, parsers,
  prompt copies, migration path, or development tests. Old run files may remain
  on disk, but current readers reject them and no gate reparses them.
- Current artifact tests reject changed prepared-evidence identity, impossible
  timestamp or duration relations, invalid transition order, detached runtime
  evidence, and malformed lifecycle state. They do not reconstruct or compare
  retained prompts, rerun retained completions through current parsers, or
  derive findings from historical output. Tests also
  force a failure after temporary-file write but before rename and require
  unchanged authoritative bytes. They separately prove successful cleanup and
  prove that an OS cleanup failure stays an explicit harness failure carrying
  the temporary path while preserving the primary `write_rejected` cause.
- Current versions validate serial benchmark lifecycle: the roster is the exact
  configuration-order/repetition-order Cartesian product; trials form an
  append-only prefix; only the final trial may run; retries link to the
  immediately previous eligible same-step failure with an identical request;
  terminal trials are immutable; and counts exactly match retained terminal
  outcomes. The repository-owned benchmark verifier observes a transient
  failure followed by success, provider exhaustion isolated from the other
  editorial track, model-level rejection, and a later completed trial. Every
  observer snapshot must parse before the verifier prints
  `evaluation: serial benchmark retained linked retries and continued
  later trials`.
- Version 9 is the current artifact. Its top-level runtime-evidence roster must match trial
  order then invocation ordinal exactly. Invocation append and pending evidence
  append are atomic; failed transport resolves only to an unavailable record;
  successful transport resolves only to captured normalized evidence; resolved
  evidence is immutable through parsing and terminal transitions. Tests reject
  missing, duplicate, reordered, detached, prematurely resolved, or mutated
  records. Historical version 8 adds the Gateway-request roster without
  projecting through or validating against any prior artifact version.
- The repository-owned trial-retention verifier controls provider release and
  directly observes both writer invocations durably `in_flight` before either
  completes. It then observes deliberate cross-track interleaving, an expected
  rejection or provider
  exhaustion isolated to one track, and both chains quiesced before aggregation.
  A controlled observer rejection after both writers dispatch proves that an
  unexpected harness failure waits for the held sibling, propagates without
  terminal aggregation or changed outcome counts, and leaves a strict browseable
  running version 9 interruption artifact. The verifier also proves normal
  terminal completion before printing `evaluation: concurrent tracks retained
  interleaved progress, diagnostics, schema rejection, infrastructure failure,
  interruption evidence, and completion`. This proves concurrent harness
  dispatch and retained-state ordering, not model-runtime parallelism.
- The repository-owned benchmark-browse verifier creates strict retained
  evidence through the loopback provider and invokes the exported eval CLI
  application boundary for all four `benchmark` routes. It proves both the
  app-owned default directory and invocation-relative `--results-dir`, rejects
  malformed and filename-mismatched artifacts, excludes volatile identity and
  timestamp noise, keeps commit-only drift in context, and observes completion
  evidence drift in behavior before printing `evaluation: evidence listed
  summarized and compared without verdicts`.
- The runtime-evidence verifier uses controlled hosted responses for all four
  production roles and requires observed, unknown, and externally controlled
  fields. It proves execution context is comparison context, prediction
  observation is behavior, independently generated run/trial/invocation
  identities do not create comparison differences, V7 completion objects do not
  gain a runtime key, and the strict roster survives store and reader round trips before printing
  `BENCHMARK RUNTIME EVIDENCE VERIFIED`.
- Evaluation code provenance is the clean repository commit itself: repository name,
  validated 40-character commit SHA, and `dirty: false`. Strict validation
  rejects missing, malformed, or extra provenance fields rather than retaining
  a redundant workspace hash.
- The active generator and recorded-replay acceptance have no automatic model
  judge, score, verdict, quality floor, threshold, or byte-pinned baseline.
  Evaluation scorecards add only transparent named role measurements and
  declared Codex assessments; they add no opaque aggregate or acceptance gate.
- Copyedit preservation checks can prove only their mechanical invariants:
  announcement identity/order, paragraph count, quotes, numeric literals,
  and protected markdown spans. They cannot prove semantic equivalence or prose
  quality. Representative live-model evaluation compares candidate model and
  inference configurations for each role before production selection; provider
  defaults are candidates rather than a privileged baseline.
- Exact context-budget measurement runs through
  `pnpm --filter @bc-news/eval eval -- context benchmark --fixture packages/fixtures`.
  Automated tests use a fake local runtime and fake completion endpoint; they
  never invoke LM Studio. The accepted representative run requires exactly one
  already-loaded local Qwen model, rejects any hosted or mixed-model config,
  and never loads, unloads, or switches model state.
- Current context-result version 4 tests require every production-step model and
  optional `temperature`, `top_p`, `top_k`, and `enable_thinking` value to
  survive write and reparse independently. Version 3, version 2, and
  absent-version context results continue through their frozen parsers.
- The representative corpus prepares to 553 messages after hygiene, so the
  truthful representative matrix is 1, 50, 100, 150, and 553.
  The benchmark records the corpus hash and ceiling; it does not pad, duplicate,
  or sample messages to manufacture a measurement row. Production preparation
  carries every message surviving hygiene to both writers. No filtering,
  retrieval, or chunking policy is introduced here.
- Each benchmark row retains the exact production request hash, structured-output
  schema hash, loaded model context length, fixed templated input, evidence or
  draft marginal, any nonnegative provider/runtime delta, provider-reported
  input usage, all non-input output usage including hidden reasoning, total,
  and remaining headroom. Component sums and model identity are rejecting
  contracts; unsupported attribution is never estimated.
- The live recorder requires an explicit two-step eval configuration using
  only `lmstudio` or `openai_compatible_hosted` adapters and performs two
  production calls. It stages and validates the exact two-file
  set on the target filesystem, replays the staged records through the shared
  runner, compares only the final editorial products, and promotes the response
  directory all-or-none with recoverable backup handling. It does not promise
  continuous visibility to concurrent readers and has no judge, threshold,
  byte pin, or source-digest acceptance gate. Its direct fixture-authoring
  verifier exercises this contract against a repository-owned loopback provider
  and temporary output; overwriting committed response fixtures remains an
  explicit developer `fixture record-responses` operation.
- Completion claims cite the domain that proved them. A test, evaluation,
  tooling, acceptance, or walk result is named honestly and never promoted into
  another domain's outcome.

## Links

- [Product requirements](PRD.md) — binds evaluation-led development and the
  skeleton-walk success signal.
- [Structural discipline](ARCHITECTURE.md) — the ports and boundary rules
  the verification domains exercise.
- [Domain model](DOMAIN.md) — the invariants deterministic tests defend.
