# bc-news

A clean rebuild (v2) of the daily regional newspaper for the BitCraft
community: validated BitJita chat activity becomes one complete edition per
active region and publication date, generated durably on Cloudflare.

**Status: walking skeleton.** The end-to-end path runs locally: a
committed fixture conversation in, one generation run through the single
Cloudflare Workflow definition, a durable edition in local D1, and the
client renders the paper.

## The walk

```sh
pnpm install
pnpm walk
```

Prerequisites: Node 22+ and pnpm. Nothing else — no Cloudflare account,
no network beyond localhost. `wrangler dev` runs the Workflow, D1, and
static assets entirely in local emulation; evidence comes from the
committed fixture and the model provider is a recorded response.

The walk builds the workspace, migrates an isolated per-run local D1,
starts `wrangler dev`, then proves the composed product sequence:

- triggering a generation run for the fixture pair (active region 7,
  publication date 2026-01-25) is accepted, and `/api/edition` serves an
  edition that parses against the shared edition schema;
- re-triggering the same pair never produces a second edition — the
  served edition is byte-identical, and the duplicate signal is recorded;
- an unknown pair answers 404, and the client HTML serves from the same
  origin.

On success it prints its own `walk:` observations followed by the independent
terminal result `WALK PASS`, plus the edition URL, and holds
`wrangler dev` so a browser can observe the rendered paper — Ctrl-C to
stop. `pnpm walk --non-interactive` (or `WALK_NON_INTERACTIVE=1`) shuts
down after the assertions instead; the exit code reflects the assertions
either way. On timeout the walk prints the generation run's status.
`WALK_PORT` overrides the port `wrangler dev` binds to (default `8787`).
The walk does not run or inherit a result from model evaluation,
recorded-response fixture authoring, context measurement, or recorded-replay
acceptance.

Where authority lives:

- [CLAUDE.md](CLAUDE.md) — the router: canonical docs, invariant floor,
  vocabulary, documentation discipline. Read it first.
- [docs/index.md](docs/index.md) — the documentation bundle root.
- [docs/PRD.md](docs/PRD.md) — binding product requirements.
- [docs/DOMAIN.md](docs/DOMAIN.md) — binding domain vocabulary.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — binding structural discipline.
- [docs/TESTING.md](docs/TESTING.md) — binding evidence discipline.

## Verification ownership

Each surface answers a different question. A result in one row never becomes a
result in another.

| Surface | Command | Evidence | Successful outcome |
|---|---|---|---|
| Deterministic tests | `pnpm test` | Isolated invariants, reproduced defects, and high-risk state transitions | Test pass or hard test failure |
| Model evaluation | `pnpm --filter @bc-news/eval eval -- benchmark run ...` and `benchmark list/show/summary/compare` | Strict versioned Benchmark Runs in `apps/eval/evaluation-results` | Retained model behavior and harness outcome; no score or acceptance verdict |
| Evaluation reference corpus | `corpus show --corpus packages/fixtures/evaluation-corpus/manifest.json` | Ordered synthetic chats plus separate exact source-witness records | Auditable source truth and variation coverage; no target article, score, or verdict |
| Evaluation scorecards | `scorecard build --input <declaration-path>` and `scorecard show <scorecard-id>` | Exact retained runs, corpus bytes, human annotations, and human qualitative reviews | Four transparent role-specific evidence reports; no aggregate score, ranking, recommendation, or acceptance verdict |
| Longitudinal evaluation scorecards | `longitudinal build --input <declaration-path>` and `longitudinal show <series-id>` | Ordered exact scorecard audit packs split into an earlier baseline and later subject observations | Four role-specific context, sufficiency, baseline-variation, or potential-drift classifications; never a judge or production gate |
| Fixture and context tooling | `fixture record-responses ...` and `context benchmark ...` | Four request-linked recorded responses, or strict context-measurement results | Fixture-authoring or context-measurement tooling result, never a walk or acceptance result |
| Recorded-replay acceptance | `acceptance run/list/show/compare` and `verify:recorded-replay-acceptance` | Historical Run Files in `apps/eval/results` | `acceptance: four recorded production steps replayed request-linked and deterministic; diagnostics retained: 4` |
| Composed skeleton walk | `pnpm walk` | The deployed local ingest, generation, D1, API, status, and browser path using committed recorded adapters | Independent `walk:` observations and terminal `WALK PASS` |

Static guarantees (`pnpm typecheck` and `pnpm lint`) support every row but do
not replace its runtime evidence.

## Model evaluation

Run a declared live benchmark with a strict configuration file containing an
ordered nonempty list of four-step configurations, a positive
`repetition_count`, and a bounded `transport_retry_limit` from zero through
three. The declared configuration/repetition roster remains serial; within each
Evaluation Trial, the main-story and announcements writer-to-copyeditor chains
dispatch concurrently:

```sh
pnpm --filter @bc-news/eval eval -- benchmark run \
	--fixture packages/fixtures/evidence/active-region-7_2026-01-24.json \
	--config path/to/eval.config.json \
	--results-dir path/to/evaluation-results
```

For Cloudflare AI Gateway, create the ignored `apps/generation/.dev.vars` with
only `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token needs
**Account > Workers AI > Read**; an AI Gateway-only token is not sufficient for
the account AI REST endpoint. Unified Billing requires loaded credits and a
payment method but no provider API keys. Then run the checked-in two-provider
example after reviewing its current model ids and expected spend:

```sh
pnpm --filter @bc-news/eval eval -- benchmark run \
	--fixture packages/fixtures/evidence/active-region-7_2026-01-24.json \
	--config apps/eval/cloudflare-ai-gateway.benchmark.example.json \
	--results-dir apps/eval/evaluation-results
```

The `cloudflare_ai_gateway` adapter uses Cloudflare's account default when
`gateway` is omitted. A named selection with an `id` is available when a
specific gateway is required. It uses Cloudflare's fixed account REST endpoint,
skips cache, retains log metadata without prompt/response payloads, attaches run
and invocation ids, sets one Gateway attempt, and bounds the request at ten minutes. The application
retains the response-scoped `cf-aig-log-id`, provider/model identity, and token
usage. The inference response does not report cost, so billing remains
`unavailable`; use the log id to reconcile Cloudflare's estimated cost without
calling it invoice truth.

Each of the four production agents has its own complete adapter configuration:
provider or adapter, model, optional `temperature`, and the adapter-specific
reasoning or billing declaration. Temperature is the only decoding control the
application admits or sends. Omitting it measures that agent's provider-default
candidate; supplying it measures that exact candidate. `top_p` and `top_k` are
not current configuration fields. A benchmark is an experiment used to compare
candidate configurations for each role and select the configuration that will
be deployed; it is not a deterministic test or a provider-default quality gate.

The command incrementally retains every Evaluation Trial and Step Invocation in
a versioned Benchmark Run. One ordered application owner allocates invocation
ordinals and applies every current transition, retaining each invocation and
its pending runtime-evidence record before provider transport. The two
concurrently dispatched chains therefore form one truthful interleaved history,
and the artifact store's atomic full-file replacement never races. Each writer
still precedes its own copyeditor. Expected
schema rejection or provider exhaustion closes only its track without
suppressing the sibling; both tracks quiesce before terminal aggregation.
Validation, persistence, or an unknown harness rejection prevents terminal
retained completion, leaving the last strict running artifact inspectable
through the benchmark browse routes.

Version 7 remains current for LM Studio and the legacy hosted adapter. A
configuration that selects `cloudflare_ai_gateway` emits version 8, adding one
lifecycle-matched Gateway-request provenance record per invocation while
preserving version 7's runtime-evidence and execution invariants. Versions 1–7
keep their historical meanings. Both current paths retain every exact per-agent
configuration, schema-valid copyedit diagnostic, and one lifecycle-matched
normalized runtime record per invocation. Their four subject outcomes are `completed`,
`parse_rejected`, `contract_rejected`, and `infrastructure_incomplete`, separate
from whether the harness retained trustworthy evidence. Malformed JSON or
strict schema mismatch is the only terminal model-output failure;
infrastructure failure is separate. Every schema-valid grammar, punctuation,
markdown, wording, preservation, or editorial-policy finding remains a
non-terminal diagnostic after one copyedit pass and never causes another model
call, rejection, or publication stop. Concurrent dispatch is an eval-harness
guarantee, not a guarantee that the selected model runtime processes requests
in parallel. It changes neither provider adapters nor the serial four-step
production Workflow, and is independent of recorded-replay acceptance, fixture
authoring, context measurement, and `pnpm walk`.

Browse retained Benchmark Runs through the same explicit namespace:

```sh
pnpm --filter @bc-news/eval eval -- benchmark list
pnpm --filter @bc-news/eval eval -- benchmark show <benchmark-run-id>
pnpm --filter @bc-news/eval eval -- benchmark summary <benchmark-run-id>
pnpm --filter @bc-news/eval eval -- benchmark compare <left-id> <right-id>
```

Each route accepts `--results-dir`; otherwise it reads
`apps/eval/evaluation-results`. Loading is strict and rejects malformed,
schema-invalid, or filename-mismatched evidence. Comparison reports input and
provenance context separately from behavioral differences and produces no
score, judge result, or acceptance decision.

Runtime evidence is visible in `benchmark show`, `benchmark summary`, and
`benchmark compare`. Comparable execution context includes the client/provider
runtime, distinct selected and response model identities with reported architecture,
parameter-count, quantization, vision, and tool-use capabilities, context/load identity,
and declared reasoning posture. Stop reason, prediction timing and throughput,
speculative counts, and reasoning-content presence remain behavior. Missing or
provider-owned fields are explicit unknown or externally controlled observations;
raw provider configuration blobs are never retained.

The committed evaluation reference corpus is an explicit source-evidence
surface, separate from model output:

```sh
pnpm --filter @bc-news/eval eval -- corpus show \
  --corpus packages/fixtures/evaluation-corpus/manifest.json
```

Its strict manifest orders twelve synthetic conversations and byte-binds each
one to a separate reference record. Reference claims, events, ambiguities,
entities, numbers, and noteworthy candidates use exact excerpts from message
fields that survive the real evidence-preparation path. Closed variation tags
carry objective witnesses for dense and sparse chats, overlapping and isolated
events, contradictions, unresolved ambiguity, names, numbers, announcement
candidates, and explicitly identified irrelevant chatter. The corpus contains
no target article, preferred angle, model output, score, or acceptance verdict;
existing benchmark and tooling commands remain single-fixture boundaries.

Build an auditable scorecard only from a complete declaration that binds one
configuration across the full corpus, retained version 7 or Gateway version 8
Benchmark Runs, exact human output annotations, and separate human qualitative
reviews:

```sh
pnpm --filter @bc-news/eval eval -- scorecard build \
  --input path/to/scorecard-input.json \
  --results-dir path/to/scorecard-results
pnpm --filter @bc-news/eval eval -- scorecard show <scorecard-id> \
  --results-dir path/to/scorecard-results
```

Without `--results-dir`, scorecards are stored under
`apps/eval/scorecard-results`. Each artifact embeds the exact source bytes and
recomputes its identities, sample counts, context, rates, Wilson intervals,
token and latency distributions, and qualitative summaries when read. The
report keeps `main_story_write`, `main_story_copyedit`, `announcements_write`,
and `announcements_copyedit` separate. Factual grounding, attribution, event
coverage, announcement relevance, coherence, usefulness, newsworthiness, and
voice retain their named human annotator or reviewer evidence; the application
does not infer those judgments. A scorecard is not a weighted model-wide score,
winner, threshold, recommendation, acceptance gate, or production decision.

Retain selected scorecard audit packs as one durable longitudinal series:

```sh
pnpm --filter @bc-news/eval eval -- longitudinal build \
  --input path/to/longitudinal-input.json \
  --results-dir path/to/longitudinal-scorecard-results
pnpm --filter @bc-news/eval eval -- longitudinal show <series-id> \
  --results-dir path/to/longitudinal-scorecard-results
```

Without `--results-dir`, series are stored under
`apps/eval/longitudinal-scorecard-results`, which is deliberately not ignored:
repository history is the durable audit boundary for selected packs. Every
series embeds the exact capability-3 scorecard bytes and reconstructs them on
read. Underlying Benchmark Run rosters must be disjoint; copying one scorecard
under a new id does not increase the evidence count.

Each role first compares a stable cohort identity over corpus and references,
prepared evidence, prompt and output contracts, exact code commit, declared
role configuration and retry policy, model/runtime identity, and normalized
execution context. Generated ids, timestamps, realized retries, token and
latency values, and prediction observations are behavior rather than context.
A genuine mismatch is `context_changed`. An unchanged cohort needs at least
three earlier baseline packs and two later subject packs plus one eligible
quantitative measurement; otherwise it is `insufficient_evidence`. Measured
rates pool exact numerators and denominators and signal only when their 95%
Wilson intervals are strictly disjoint. Each token and latency dimension stays
separate and signals only when observed ranges are strictly disjoint. Any such
named witness yields `potential_drift`; otherwise the role is
`within_baseline`. Qualitative histories remain visible, categorical human
evidence and never drive the classifier.

These labels are conservative observations, not causality, equivalence,
quality, model ranking, recommendation, retry behavior, acceptance, or a
production decision. Exact commit identity means even an unrelated commit is
changed context; copyeditor prompt hashes also include the variable writer
draft. Counted units within one output may be correlated, range checks can be
masked by baseline extremes, inspecting several named metrics has multiplicity
risk, and human evidence may vary without proving model drift.

The historical artifact is a **Run File**, not a Benchmark Run. Recorded-replay
acceptance alone owns it and its separate default directory:

```sh
pnpm --filter @bc-news/eval eval -- acceptance run \
  --fixture packages/fixtures
pnpm --filter @bc-news/eval eval -- acceptance list
pnpm --filter @bc-news/eval eval -- acceptance show <run-file-id>
pnpm --filter @bc-news/eval eval -- acceptance compare <left-id> <right-id>
```

The default acceptance configuration is
`apps/eval/recorded-replay.config.json`; `acceptance run` also accepts an
explicit `--config`, and all acceptance routes accept `--results-dir` where
applicable. Run Files live in `apps/eval/results` by default. Current Run Files
require exact ordered diagnostics; historical files without that field report
diagnostics as unknown, not as observed empty. Production diagnostics are
operator evidence in generation status and are not part of `EditionSchema`.

Fixture authoring and context measurement are tooling surfaces rather than
evaluation or acceptance:

```sh
pnpm --filter @bc-news/eval eval -- fixture record-responses \
  --fixture packages/fixtures \
  --config path/to/live.config.json
pnpm --filter @bc-news/eval eval -- context benchmark \
  --fixture packages/fixtures
```

Fixture authoring defaults to `packages/fixtures/model-responses` and accepts
`--response-dir`. Current recorded-response version 3 artifacts retain the
exact configuration of their production step. Context measurement defaults to
`apps/eval/context-results` and accepts `--results-dir`. Current context-result
version 3 artifacts retain all four exact agent configurations. Historical
versions keep their original meaning. Either tool may omit or independently set
temperature for each step; the declaration determines the experiment. Explicit
paths are resolved relative to the invoking workspace. The old bare `evaluate`,
`run`, `record`, `context`, `list`, `show`, and `compare` routes do not exist.

Repository-owned runtime proofs are direct package commands:

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
```

The evaluation proofs print `evaluation:` observations. Trial retention ends
with `evaluation: concurrent tracks retained interleaved progress, diagnostics,
schema rejection, infrastructure failure, interruption evidence, and
completion`; the continuation and browse proofs respectively end with
`evaluation: serial benchmark retained linked retries and continued later trials`
and
`evaluation: evidence listed summarized and compared without verdicts`.
Runtime-evidence verification ends with
`BENCHMARK RUNTIME EVIDENCE VERIFIED`.
Reference-corpus verification ends with
`EVALUATION REFERENCE CORPUS VERIFIED` after the committed manifest, hashes,
prepared source witnesses, directory closure, and objective variation rules
pass their positive and corruption proofs.
Scorecard verification ends with `EVALUATION SCORECARDS VERIFIED` after the
real builder, strict store/read path, report, both CLI routes, exact context and
denominator calculations, human-evidence linkage, and corruption matrix pass.
Longitudinal verification ends with
`EVALUATION LONGITUDINAL SCORECARDS VERIFIED` after the committed 3+2 audit
pack, stable cohort normalization, all four classifications, independent
pooled-statistic calculations, exact store/read/report/CLI path, and corruption
matrix pass.
Fixture proof prints
`fixture authoring: four strict v3 hosted responses retained exact agent configurations, replayed, and compared`;
recorded-replay proof prints
`acceptance: four recorded production steps replayed request-linked and deterministic; diagnostics retained: 4`.
None of these commands prints or confers `WALK PASS`.

Local benchmark declarations may compare Qwen, Bonsai, Gemma, or other loaded
models and independent temperatures for each of the four roles. A declaration
may also omit temperature for any role to include its provider default as one
candidate. Run declarations through `benchmark run`, inspect each returned id
through `benchmark summary`, and use the retained products, diagnostics, usage,
and infrastructure evidence to choose each production agent's configuration.
Trial outcomes are observations, not grammar-based quality failures or
acceptance verdicts.

The frozen v1 (`bc-news-worker` and siblings, in the parent directory) is
reference material only — see the [v1 reference map](docs/v1-reference.md).
