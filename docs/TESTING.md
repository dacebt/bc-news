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
  at: "2026-08-06T21:23:59Z"
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
outcome or silently substitutes for it.

| Domain | Command | Evidence | Outcome |
|---|---|---|---|
| Deterministic tests | `pnpm test` | Isolated warranted invariants, reproduced defects, and high-risk state transitions | Test pass or hard test failure; never a retained model attempt |
| Scratch model run | `scratch run` | One live four-step production pass saved only to an explicitly selected results directory | Development inspection artifact; never a Benchmark Run, scorecard source, baseline, or acceptance verdict |
| Model evaluation | `benchmark run/list/show/summary/compare` | Strict versioned Benchmark Runs under `apps/eval/evaluation-results` | Retained model subject and harness outcomes with `evaluation:` observations; never a score or acceptance verdict |
| Evaluation reference corpus | `corpus show --corpus <manifest-path>` and its direct verifier | Commit-addressed ordered synthetic fixtures and separate exact source-witness references | Auditable source truth and objective variation coverage; never a model result, score, or acceptance verdict |
| Evaluation scorecards | `scorecard build/show` and `verify:evaluation-scorecards` | Commit-addressed V7 or Gateway V8 runs and corpus sources with Codex annotations and qualitative reviews | Four transparent role-specific measurements plus current/outdated checkout information; never an aggregate score, ranking, recommendation, or acceptance verdict |
| Longitudinal evaluation scorecards | `longitudinal build/show` and `verify:evaluation-longitudinal-scorecards` | Exact ordered scorecard audit packs, stable role cohorts, and baseline/subject histories | Four role-specific context, sufficiency, baseline-variation, or potential-drift observations; never a judge or product gate |
| Fixture and context tooling | `fixture record-responses` and `context benchmark` | Four request-linked recorded responses, or strict context results | Fixture-authoring or context-measurement tooling result; never acceptance or a walk |
| Recorded-replay acceptance | `acceptance run/list/show/compare` and its direct verifier | Historical Run Files under `apps/eval/results` | `acceptance:` result over controlled replay; never a Benchmark Run outcome |
| Composed skeleton walk | `pnpm walk` | The running local ingest, generation, persistence, API, status, and browser product | Walk-owned `walk:` observations followed by independent terminal `WALK PASS` |

**Deterministic tests** protect warranted invariants, reproduced defects, and
high-risk state transitions. A failing test is a hard failed test; it is not a
retained model-evaluation attempt.

**Scratch model runs** use `scratch run --fixture <path> --config <path>
--results-dir <path>` to execute the current four-step production path against
local or hosted models while prompts and configurations are still changing.
The caller must choose the results directory; use a path under `/tmp` for
disposable comparisons. Hosted requests receive run and invocation correlation.
Scratch runs do not require a clean worktree, use a frozen Benchmark Run
contract, enter the retained evaluation-results directory, establish a
baseline, or supply scorecard or acceptance evidence.

**Model evaluation** uses `benchmark run --fixture <path> --config <path>
[--results-dir <path>]` to observe an ordered configuration and repetition
roster serially. Within each Evaluation Trial, the main-story and announcements
writer-to-copyeditor chains dispatch concurrently, with each writer preceding
its own copyeditor. One ordered application owner allocates invocations and
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
schema-mismatch model-output rejection in Gateway artifact version 8. Current
non-Gateway version 7 artifacts require textual completion content. Both tracks quiesce before terminal
aggregation; interruption leaves a strict running version 7 or
Gateway-only version 8
artifact browseable through `benchmark list`, `benchmark show`, `benchmark
summary`, and `benchmark compare`. Concurrent dispatch proves harness
scheduling, not parallel processing inside a selected model runtime. Comparison
separates fixture, configuration, and provenance context from behavior and
reports no score, judge result, recommendation, or acceptance decision.

Benchmark Run version 7 retains existing live configurations. A
`cloudflare_ai_gateway` configuration emits version 8 and additionally requires
one lifecycle-matched Gateway-request record for every invocation, including
the response-scoped log id and declared cache/logging/retry/timeout policy on
success. New Gateway records additionally retain the exact model-profile
request format and structured-output contract name. Both current paths retain bounded structured provider-error
details for deterministic Gateway HTTP rejections so an infrastructure failure
identifies the rejected parameter and provider reason rather than only the
status code. OpenAI request profiles prove that every wire property is required,
canonical optional properties are nullable, and returned null placeholders
normalize back to the canonical optional shape. Both current paths
retain every exact per-agent configuration, schema-valid copyedit diagnostic,
and a lifecycle-matched runtime-evidence record for every invocation. Each role
independently chooses a provider, model, and optional temperature; omission
includes that role's provider default as a candidate. Temperature is the only
operator-configurable decoding control. LM Studio and profiled Gateway models
receive the same strict production-step JSON Schema, while each Gateway model
profile owns its provider request encoding. Model evaluation compares these
candidate configurations to select production settings; it is not a
deterministic test or a provider-default quality gate.
Version 8 preserves version 7's four subject outcomes: `completed`,
`parse_rejected`, `contract_rejected`, and
`infrastructure_incomplete`. Runtime evidence separates comparable execution
context from volatile prediction observation and represents every unavailable
field as an explicit unknown or externally controlled state.

Malformed JSON or strict schema mismatch is the only terminal model-output
failure. Infrastructure failure is classified separately. Every schema-valid
grammar, punctuation, markdown, wording, preservation, or editorial-policy
finding is retained as a non-terminal diagnostic after one copyedit pass and
never causes another model call, rejection, or publication stop.

**Fixture and context tooling** owns two different development artifacts.
`fixture record-responses --fixture <path> --config <path> [--response-dir
<path>]` writes the exact four request-linked response files only after staged
replay and comparison. `context benchmark --fixture <path> [--results-dir
<path>]` writes strict context-measurement results. Neither tool creates a
Benchmark Run or Run File and neither confers acceptance.
Current recorded-response version 3 and context-result version 3 artifacts
retain every exact per-step configuration and optional temperature. Historical
versions keep their original meanings. Either tool may independently omit or
set temperature for each step; the declaration, not the command name,
determines the experiment.

**The evaluation reference corpus** is a deterministic input-evidence domain,
not a model evaluation result. `corpus show --corpus <manifest-path>` explicitly
selects a strict ordered version 2 manifest whose repository-relative paths
pair each synthetic chat with one separate reference at the manifest's Git
commit. References retain exact source excerpts and
closed classifications only; every cited message and excerpt must survive the
real evidence-preparation path. Objective witnesses prove every declared
variation tag, and closed directories reject unlisted evidence. This domain
supplies future measurements with auditable denominators without prescribing a
target article, angle, wording, score, or verdict. Existing commands do not
accept `--corpus` and do not silently select a corpus entry.

**Evaluation scorecards** consume, but never alter, complete retained version 7
or Gateway version 8 Benchmark Runs and the full ordered reference corpus. A
version 8 output identity requires the hash of its exact Gateway-request record,
and identified role context retains the ordered request-record hashes without
turning response-scoped log ids into stable longitudinal context. `scorecard
build --input <declaration-path> [--results-dir <path>]` requires one exact
configuration, every corpus fixture in order, every selected trial and invocation
attempt, exact source-linked Codex annotations for every parse-success output,
and a separate exact Codex qualitative review for every such output. `scorecard show
<scorecard-id> [--results-dir <path>]` resolves the recorded declaration and
all named evidence with `git show` and recomputes the artifact before reporting
it. The corpus context uses the commit that last changed the closed corpus
subtree, not a later scorecard-storage commit. Version 1 human evidence retains
its frozen historical contract and remains readable through the public store
and report path.

The four production roles remain separate. Rates expose their exact numerator,
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

**Longitudinal evaluation scorecards** consume exact commit-addressed scorecard
audit packs without rewriting historical version 1 evidence. `longitudinal build
--input <declaration-path> [--results-dir <path>]` requires ordered, unique,
contained commit-and-path references with pairwise-disjoint underlying Benchmark
Run ids. Baseline packs are all earlier than subject packs. `longitudinal
show <series-id> [--results-dir <path>]` reloads every referenced scorecard through
the existing public reader and recomputes all cohorts, histories, statistics,
and classifications. The public reader also dispatches frozen version 1
embedded audit packs through their historical reconstruction/report path.
Default artifacts live under
`apps/eval/longitudinal-scorecard-results` and are deliberately commit-eligible;
repository history is the durable audit boundary.

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
acceptance, or production action. Copyeditor prompt identity includes the upstream writer
draft. Counted units can be correlated, baseline extremes can mask range
movement, multiple named metrics raise multiplicity risk, and Codex annotations
or reviews can vary without proving model drift.

Freshness is separate from cohort comparison and artifact validity. Build and
show compare each evaluated code commit with the explicitly resolved repository
root's `HEAD` and report `current` or `outdated`. A different commit is never a
failure, rejection, acceptance gate, or reason to prevent another evaluation.

**Recorded-replay acceptance** uses `acceptance run --fixture <path> [--config
<path>] [--results-dir <path>]` and `acceptance list/show/compare`. It executes
the four dependent production steps twice. Results must be identical apart from
run identity and timestamps, carry the exact ordered roster and usage, match
parsed recorded responses, recompute request relations from the requests
actually built, and assemble the final edition from the two copyedited
products. This is an explicit acceptance gate over controlled evidence, not a
live model evaluation. Its artifact is the historical Run File, not a
Benchmark Run. Current Run Files require exact ordered diagnostics; historical
files without the field report diagnostics as unknown, never as observed empty.

**The composed skeleton walk** runs a fixed local conversation through the whole
pipeline: ingest into a fresh isolated D1 database; the real scheduled
generation Workflow; `main_story_write`, `main_story_copyedit`,
`announcements_write`, and `announcements_copyedit`; deterministic validation,
assembly, and publication; the operator status projection; API read; and the
published/unavailable/Back reader experience in installed Chrome. It uses
exactly four recorded responses and no production data, live model, paid
service, or external origin. The status proof requires all seven generation
steps in order, exactly four ordered recorded-replay usage records at zero
external billing, and the exact ordered diagnostics from the representative
schema-valid copyedit. The served edition must equal the two copyedited products,
derive grouped writer/copyeditor provenance from those four usages, and contain
no internal announcement ids. Duplicate delivery must preserve edition bytes
and usage, and an unknown pair must remain absent. Browser traffic is
same-origin-only and exactly two pair-addressed edition 404s are allowed. This
is the [PRD](PRD.md)'s first success signal and proves the composed deployable
product. It does not invoke the evaluation, fixture-authoring, context, or
acceptance verifiers. A passing test, retained Evaluation Trial, tooling result,
or acceptance gate cannot replace its own `WALK PASS`.

**Static guarantees** support every domain. Strict TypeScript, lint, and zod
contracts parse-and-reject at every boundary; they do not prove runtime
behavior.

## Direct verification sequence

Run domain proofs independently, then the ordinary repository gates, then the
composed walk:

```sh
pnpm --filter @bc-news/eval verify:evaluation-trial-retention
pnpm --filter @bc-news/eval verify:evaluation-benchmark-continuation
pnpm --filter @bc-news/eval verify:evaluation-browse
pnpm --filter @bc-news/eval verify:benchmark-runtime-evidence
pnpm --filter @bc-news/eval verify:evaluation-reference-corpus
pnpm --filter @bc-news/eval verify:evaluation-scorecards
pnpm --filter @bc-news/eval verify:evaluation-longitudinal-scorecards
pnpm --filter @bc-news/eval verify:recorded-response-fixture-authoring
pnpm --filter @bc-news/eval verify:recorded-replay-acceptance
pnpm test
pnpm typecheck
pnpm lint
pnpm walk --non-interactive
```

The command-contract tests additionally exercise every namespaced CLI route,
option ownership, namespace-specific failure prefix, and rejection of the old
bare `evaluate`, `run`, `record`, `context`, `list`, `show`, and `compare`
routes. After a namespace is recognized, failures begin with `benchmark
failed:`, `acceptance failed:`, `fixture authoring failed:`, `context
benchmark failed:`, `corpus failed:`, `scorecard failed:`, or `longitudinal
scorecard failed:`. Failures before namespace recognition begin with `command
failed:`; `eval failed:` is forbidden.

The three evaluation verifiers print `evaluation:` observations. Trial
retention ends with `evaluation: concurrent tracks retained interleaved
progress, diagnostics, schema rejection, infrastructure failure, interruption
evidence, and completion`, continuation ends with
`evaluation: serial benchmark retained
linked retries and continued later trials`, and browsing ends with `evaluation:
evidence listed summarized and compared without verdicts`. Runtime-evidence
verification exercises the real
command, store, reader, projection, and summary path with controlled providers
and ends exactly with `BENCHMARK RUNTIME EVIDENCE VERIFIED`. Reference-corpus
verification loads the committed corpus through the production reader, runs
the complete corruption matrix, and ends exactly with `EVALUATION REFERENCE
CORPUS VERIFIED`. Scorecard verification assembles controlled complete version
7 runs for the committed corpus through the real input, builder, store, reader,
report, and CLI paths; proves the exact counts, contexts, rates, intervals,
distributions, Codex-evidence linkage, commit-path resolution, non-blocking
outdated reporting, and semantic corruption checks; and ends exactly
with `EVALUATION SCORECARDS VERIFIED`. Longitudinal verification creates a
compact committed 3+2 audit pack and independently recomputes stable cohort
normalization, pooled rates, Wilson intervals, raw token/latency distributions,
four role classifications, store/read/report/CLI behavior, commit-backed
reopen, and outdated reporting, then ends exactly with
`EVALUATION LONGITUDINAL SCORECARDS VERIFIED`. Fixture proof ends
with `fixture authoring: four strict v3 hosted responses retained exact agent
configurations, replayed, and compared`. Acceptance proof ends with `acceptance: four
recorded production steps replayed request-linked and deterministic; diagnostics
retained: 4`. The composed walk prints none
of those exact verifier observations; it ends with its independent `WALK PASS`.

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
- Current Benchmark Runs validate only as version 7 or Gateway version 8.
  Versions 1 through 6 have no active schemas, parsers, prompt copies, migration
  path, or development tests. Old run files may remain on disk, but current
  readers reject them and no gate reparses them.
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
- Version 7 is the current non-Gateway artifact. Its top-level runtime-evidence roster must match trial
  order then invocation ordinal exactly. Invocation append and pending evidence
  append are atomic; failed transport resolves only to an unavailable record;
  successful transport resolves only to captured normalized evidence; resolved
  evidence is immutable through parsing and terminal transitions. Tests reject
  missing, duplicate, reordered, detached, prematurely resolved, or mutated
  records. Version 8 adds the Gateway-request roster without projecting through
  or validating against any prior artifact version.
- The repository-owned trial-retention verifier controls provider release and
  directly observes both writer invocations durably `in_flight` before either
  completes. It then observes deliberate cross-track interleaving, each
  writer-before-copyeditor dependency, an expected rejection or provider
  exhaustion isolated to one track, and both chains quiesced before aggregation.
  A controlled observer rejection after both writers dispatch proves that an
  unexpected harness failure waits for the held sibling, propagates without
  terminal aggregation or changed outcome counts, and leaves a strict browseable
  running version 7 interruption artifact. The verifier also proves normal
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
  temperature configurations for each role before production selection;
  provider defaults are candidates rather than a privileged baseline.
- Exact context-budget measurement runs through
  `pnpm --filter @bc-news/eval eval -- context benchmark --fixture packages/fixtures`.
  Automated tests use a fake local runtime and fake completion endpoint; they
  never invoke LM Studio. The accepted representative run requires exactly one
  already-loaded local Qwen model, rejects any hosted or mixed-model config,
  and never loads, unloads, or switches model state.
- Current context-result version 3 tests require every per-agent model and
  optional temperature to survive write and reparse independently. Version 2
  and absent-version context results continue through their frozen parsers.
- The representative corpus prepares to 208 messages under the unchanged
  evidence-message sampler, so the truthful representative matrix is 1, 50,
  100, 150, and 208.
  The benchmark records the corpus hash and ceiling; it does not pad or duplicate
  messages to manufacture a 300-message row. The production baseline remains at
  most 300 messages, at most 13 from each UTC hour, stable FNV selection from
  `activeRegionId|publicationDate|message.id`, and truthful `sampling_dropped`
  accounting. No filtering, retrieval, or chunking policy changes here.
- Each benchmark row retains the exact production request hash, structured-output
  schema hash, loaded model context length, fixed templated input, evidence or
  draft marginal, any nonnegative provider/runtime delta, provider-reported
  input and completion usage, total, and remaining headroom. Component sums and
  model identity are rejecting contracts; unsupported attribution is never
  estimated.
- The live recorder requires an explicit four-step live eval configuration and
  performs four dependent calls. It stages and validates the exact four-file
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
