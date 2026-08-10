---
type: doc
title: >-
  bc-news test and verification posture
description: >-
  The binding evidence discipline for bc-news v2 — what proves a change works, what the recorded replay proves, and what still requires representative model evaluation.
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
| Model evaluation | `benchmark run/list/show/summary/compare` | Strict versioned Benchmark Runs under `apps/eval/evaluation-results` | Retained model subject and harness outcomes with `evaluation:` observations; never a score or acceptance verdict |
| Evaluation reference corpus | `corpus show --corpus <manifest-path>` and its direct verifier | Ordered synthetic fixture bytes and separate exact source-witness references | Auditable source truth and objective variation coverage; never a model result, score, or acceptance verdict |
| Fixture and context tooling | `fixture record-responses` and `context benchmark` | Four request-linked recorded responses, or strict context results | Fixture-authoring or context-measurement tooling result; never acceptance or a walk |
| Recorded-replay acceptance | `acceptance run/list/show/compare` and its direct verifier | Historical Run Files under `apps/eval/results` | `acceptance:` result over controlled replay; never a Benchmark Run outcome |
| Composed skeleton walk | `pnpm walk` | The running local ingest, generation, persistence, API, status, and browser product | Walk-owned `walk:` observations followed by independent terminal `WALK PASS` |

**Deterministic tests** protect warranted invariants, reproduced defects, and
high-risk state transitions. A failing test is a hard failed test; it is not a
retained model-evaluation attempt.

**Model evaluation** uses `benchmark run --fixture <path> --config <path>
[--results-dir <path>]` to observe an ordered configuration and repetition
roster serially. Within each Evaluation Trial, the main-story and announcements
writer-to-copyeditor chains dispatch concurrently, with each writer preceding
its own copyeditor. One ordered application owner allocates invocations and
applies every retained version 7 transition, retaining each invocation and its
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
the independent editorial track or later declared trials. Both tracks quiesce
before terminal aggregation; interruption leaves a strict running version 7
artifact browseable through `benchmark list`, `benchmark show`, `benchmark
summary`, and `benchmark compare`. Concurrent dispatch proves harness
scheduling, not parallel processing inside a selected model runtime. Comparison
separates fixture, configuration, and provenance context from behavior and
reports no score, judge result, recommendation, or acceptance decision.

Current Benchmark Run version 7 retains every exact per-agent configuration,
schema-valid copyedit diagnostic, and a lifecycle-matched runtime-evidence
record for every invocation. Each role independently
chooses a provider, model, and optional temperature; omission includes that
role's provider default as a candidate. Temperature is the only decoding
control admitted or sent. Model evaluation compares these candidate
configurations to select production settings; it is not a deterministic test or
a provider-default quality gate. Version 7 preserves version 6's four subject
outcomes: `completed`, `parse_rejected`, `contract_rejected`, and
`infrastructure_incomplete`. Runtime evidence separates comparable execution
context from volatile prediction observation and represents every unavailable
field as an explicit unknown or externally controlled state. Versions 1–6
remain frozen historical contracts.

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
selects a strict ordered manifest whose exact hashes pair each synthetic chat
with one separate reference. References retain exact source excerpts and
closed classifications only; every cited message and excerpt must survive the
real evidence-preparation path. Objective witnesses prove every declared
variation tag, and closed directories reject unlisted evidence. This domain
supplies future measurements with auditable denominators without prescribing a
target article, angle, wording, score, or verdict. Existing commands do not
accept `--corpus` and do not silently select a corpus entry.

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
benchmark failed:`, or `corpus failed:`. Failures before namespace recognition begin with `command
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
CORPUS VERIFIED`. Fixture proof ends
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
- **Recorded artifacts are inputs, not byte-level expectations.** Recorded-replay
  acceptance recomputes relations from the current evidence, the exported
  prompt builders, the recorded responses, and the run being checked. The
  recorder writes `prompt_sha256` from the request it actually sends, binding
  that recorded response to that request. The current committed writer
  responses are migrated fixtures and the copyedit responses are synthetic
  fixtures; their stamps are reconstructed request associations, not
  recorder-authored provenance. No stamp is durable proof that a particular
  model authored the response text. Editing a recorder-authored stamp by hand
  asserts provenance that never happened and is never a fix for a red gate.
- **Over-broad source digests are provenance, not gates.** Source fingerprints,
  `code_version`, and retained run-file bytes may remain comparison evidence,
  but never become acceptance pins. A guard that fires because unrelated source
  text moved carries no useful product information.
- Determinism is proved by re-executing recorded-replay acceptance rather than
  against a stored file. Its comparison reports every differing field except
  `id`, `started_at`, and `completed_at`.
- Recorded-replay verification parses every Run File it produces with the
  strict historical schema. A human comparison report is not an acceptance
  gate.
- Versioned model-evaluation artifacts validate against their own frozen
  semantics. Version 1 rejects changed contract representations or hashes,
  prepared-evidence snapshots that no longer match their identity and summary,
  writer requests that do not exactly match the v1-local prompt and transcript
  derived from that snapshot, impossible timestamp or duration relations, and
  fabricated, missing, extra, or drifted final-product findings. Tests also
  force a failure after temporary-file write but before rename and require
  unchanged authoritative bytes. They separately prove successful cleanup and
  prove that an OS cleanup failure stays an explicit harness failure carrying
  the temporary path while preserving the primary `write_rejected` cause. V1
  validation does not call mutable production parsers, prompt builders,
  fencing, or product checks when re-validating historical evidence.
- Versions 2 and 3 validate serial benchmark lifecycle: the roster is the exact
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
- Version 3 additionally freezes the current corrected writer requests and
  copyedit-preservation parser. Contract tests require its system messages,
  writer prompts, and dependent copyedit prompts to equal the production
  builders at the version boundary, and require boundary-only blank separators
  to remain non-structural. Version 1 and version 2 validation continue through
  their frozen original prompt and preservation semantics.
- Version 4 preserves the version 3 prompt and preservation boundary while
  retaining sampling posture truthfully. Tests prove provider-default
  declarations omit all three native SDK properties, explicit declarations
  retain an unchanged complete tuple, partial tuples reject, and versions 1–3
  still validate only against their frozen semantics.
- Version 5 preserves version 4 sampling semantics as a frozen historical
  contract. It completes schema-valid products with exact
  preservation and final-product diagnostics and has only `completed`,
  `parse_rejected`, `contract_rejected`, and `infrastructure_incomplete`
  outcomes; versions 1–4 continue through their frozen parsers.
- Version 6 retains exact independent configurations for all four
  production agents, accepts optional temperature as the only decoding control,
  and rejects obsolete `sampling`, `top_p`, and `top_k` fields. Versions 1–5
  continue through their frozen parsers.
- Version 7 is current. Its top-level runtime-evidence roster must match trial
  order then invocation ordinal exactly. Invocation append and pending evidence
  append are atomic; failed transport resolves only to an unavailable record;
  successful transport resolves only to captured normalized evidence; resolved
  evidence is immutable through parsing and terminal transitions. Tests reject
  missing, duplicate, reordered, detached, prematurely resolved, or mutated
  records, and prove versions 1–6 still parse without accepting runtime evidence
  inside their strict completion objects. Each representative historical parser
  proof includes at least one successful completion.
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
  identities do not create comparison differences, V7 legacy completions do not
  gain a runtime key, and the strict roster survives store and reader round trips before printing
  `BENCHMARK RUNTIME EVIDENCE VERIFIED`.
- V1 code provenance is the clean repository commit itself: repository name,
  validated 40-character commit SHA, and `dirty: false`. Strict validation
  rejects missing, malformed, or extra provenance fields rather than retaining
  a redundant workspace hash.
- The active generator and recorded-replay acceptance have no automatic model judge,
  score, verdict, quality floor, threshold, or byte-pinned baseline.
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
