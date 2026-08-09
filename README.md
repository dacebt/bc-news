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
| Fixture and context tooling | `fixture record-responses ...` and `context benchmark ...` | Four request-linked recorded responses, or strict context-measurement results | Fixture-authoring or context-measurement tooling result, never a walk or acceptance result |
| Recorded-replay acceptance | `acceptance run/list/show/compare` and `verify:recorded-replay-acceptance` | Historical Run Files in `apps/eval/results` | `acceptance: four recorded production steps replayed request-linked and deterministic; diagnostics retained: 4` |
| Composed skeleton walk | `pnpm walk` | The deployed local ingest, generation, D1, API, status, and browser path using committed recorded adapters | Independent `walk:` observations and terminal `WALK PASS` |

Static guarantees (`pnpm typecheck` and `pnpm lint`) support every row but do
not replace its runtime evidence.

## Model evaluation

Run a declared serial live benchmark with a strict configuration file containing
an ordered nonempty list of four-step configurations, a positive
`repetition_count`, and a bounded `transport_retry_limit` from zero through
three:

```sh
pnpm --filter @bc-news/eval eval -- benchmark run \
  --fixture packages/fixtures \
  --config path/to/eval.config.json \
  --results-dir path/to/evaluation-results
```

Each of the four production agents has its own complete adapter configuration:
provider or adapter, model, optional `temperature`, and the adapter-specific
reasoning or billing declaration. Temperature is the only decoding control the
application admits or sends. Omitting it measures that agent's provider-default
candidate; supplying it measures that exact candidate. `top_p` and `top_k` are
not current configuration fields. A benchmark is an experiment used to compare
candidate configurations for each role and select the configuration that will
be deployed; it is not a deterministic test or a provider-default quality gate.

The command incrementally retains every Evaluation Trial and Step Invocation in
a versioned Benchmark Run. The current version 6 artifact retains every exact
per-agent configuration and schema-valid copyedit diagnostic; versions 1–5
keep their frozen historical semantics. Its four subject outcomes
are `completed`, `parse_rejected`, `contract_rejected`, and
`infrastructure_incomplete`, separate from whether the harness retained
trustworthy evidence. Malformed JSON or strict schema mismatch is the only
terminal model-output failure; infrastructure failure is separate. Every
schema-valid grammar, punctuation, markdown, wording, preservation, or
editorial-policy finding remains a non-terminal diagnostic after one copyedit
pass and never causes another model call, rejection, or publication stop. This
is independent of recorded-replay acceptance, fixture authoring, context
measurement, and `pnpm walk`.

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
pnpm --filter @bc-news/eval verify:recorded-response-fixture-authoring
pnpm --filter @bc-news/eval verify:recorded-replay-acceptance
```

The evaluation proofs print `evaluation:` observations. Trial retention ends
with `evaluation: diagnostics, schema rejection, infrastructure failure, and
completion retained incrementally`; the continuation and browse proofs
respectively end with
`evaluation: serial benchmark retained linked retries and continued later trials`
and
`evaluation: evidence listed summarized and compared without verdicts`.
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
