---
type: doc
title: >-
  bc-news evaluation operations
description: >-
  Descriptive operator guide to evaluation commands, local artifact routes, live-provider setup, and the boundaries between scratch, benchmark, corpus, scorecard, aggregate, acceptance, fixture, context, and walk evidence.
tags: [documentation, evaluation, operations, verification]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:58:59Z"
authority: descriptive
---

# bc-news evaluation operations

This is the operator route for the evaluation CLI. The binding meaning of each
evidence domain lives in [test and verification posture](TESTING.md). Model
admission and mutable provider pricing live in [model admission and pricing](model-pricing.md).
These commands never inherit a pass, verdict, or recommendation from another
surface.

Run the CLI from the repository root:

```sh
pnpm --filter @bc-news/eval eval -- <route>
```

## Choose the right route

| Intent | Route | Default artifact location or required destination |
|---|---|---|
| Inspect one disposable live four-step run | `scratch run --fixture <path> --config <path> --results-dir <path>` | Caller must select `--results-dir`; use a path under `/tmp` for disposable work |
| Retain a declared experiment | `benchmark run --fixture <path> --config <path> [--results-dir <path>]` | `apps/eval/local-data/evaluation-results` |
| Browse or compare benchmarks | `benchmark list`, `benchmark show <id>`, `benchmark summary <id>`, `benchmark compare <left-id> <right-id>` | Same benchmark directory; each route accepts `--results-dir` |
| Build or inspect a reference corpus | `corpus extract --snapshot <sqlite-path> --selection <selection-path>`, `corpus show --corpus <manifest-path>` | `apps/eval/local-data/corpus-workspaces` |
| Build or inspect role scorecards | `scorecard build --input <declaration-path>`, `scorecard show <id>` | `apps/eval/local-data/scorecards` |
| Export or inspect content-free aggregates | `aggregate export --input <scorecard-path> --cohort <id>`, `aggregate show <id>`, `aggregate compare <left-id> <right-id>` | `apps/eval/summaries` unless `--results-dir` is selected |
| Build or inspect longitudinal observations | `longitudinal build --input <declaration-path>`, `longitudinal show <id>` | `apps/eval/local-data/longitudinal-scorecards` |
| Record one complete response fixture set | `fixture record-responses --fixture <path> --config <path> [--response-dir <path>]` | `packages/fixtures/model-responses` unless `--response-dir` is selected |
| Measure context | `context benchmark --fixture <path> [--results-dir <path>]` | `apps/eval/context-results` unless `--results-dir` is selected |
| Replay recorded responses | `acceptance run --fixture <path> [--config <path>]`, `acceptance list`, `acceptance show <id>`, `acceptance compare <left-id> <right-id>` | `apps/eval/local-data/acceptance-results` |

Current artifact routes use the listed local defaults. Explicitly addressed
legacy directories remain readable where their historical contract is
supported.

## Live provider setup

For Cloudflare AI Gateway, copy the ignored developer-variable example and set
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in
`apps/generation/.dev.vars`. The token must be able to call the account AI REST
endpoint; an AI Gateway-only token is insufficient. Unified Billing requires
loaded credits and a payment method, but no provider API key. Review the model
ids and current spend in [model admission and pricing](model-pricing.md) before
running a hosted configuration.

The checked-in Gateway example currently compares `openai/gpt-5-nano` and
`google/gemini-2.5-flash-lite`, one repetition each:

```sh
pnpm --filter @bc-news/eval eval -- benchmark run \
  --fixture packages/fixtures/evidence/active-region-7_2026-01-24.json \
  --config apps/eval/cloudflare-ai-gateway.benchmark.example.json
```

The example is an editable starting point, not a current recommendation. A
benchmark configuration declares an ordered nonempty roster, a positive
`repetition_count`, and `transport_retry_limit` from zero through three. Each of
the four production steps has its own adapter/model configuration. The
main-story and announcements chains can dispatch concurrently in evaluation,
while each writer still precedes its copyeditor; the production Workflow itself
remains serial.

## Artifact and outcome boundaries

- Scratch runs are explicitly disposable development inspection. They do not
  enter the benchmark store or establish a baseline.
- Benchmark Runs retain strict step, transport, runtime, and harness evidence.
  Current non-Gateway runs use artifact version 7; Gateway runs use version 8
  with lifecycle-matched Gateway provenance. Neither version produces a score
  or acceptance verdict.
- Corpus workspaces retain selection-bound source truth. Scorecards measure four
  roles; aggregates export content-free descriptive results; longitudinal
  series classify context, sufficiency, baseline variation, or potential drift.
  None selects a winner or production model.
- Fixture recording calls four dependent production steps, stages and validates
  the full response roster, replays it, then promotes the directory as one
  recoverable unit. The current recorder supports LM Studio and the legacy
  OpenAI-compatible hosted adapter; it rejects `recorded` and
  `cloudflare_ai_gateway` configurations.
- Recorded-replay acceptance uses committed recorded responses and retains
  diagnostics. Its direct verifier succeeds with
  `acceptance: four recorded production steps replayed by step and deterministic; diagnostics retained: 4`.
- `pnpm walk` owns the local composed-product result and terminal `WALK PASS`.
  It consumes committed recorded responses but never authors them.

## Direct verification commands

The eval package exposes direct contract checks when a specific surface changes:

```sh
pnpm --filter @bc-news/eval verify:recorded-replay-acceptance
pnpm --filter @bc-news/eval verify:evaluation-corpus-extraction
pnpm --filter @bc-news/eval verify:evaluation-scorecards
pnpm --filter @bc-news/eval verify:evaluation-aggregate-results
pnpm --filter @bc-news/eval verify:evaluation-longitudinal-scorecards
```

The corpus extraction verifier ends with `EVALUATION CORPUS EXTRACTION VERIFIED`.
Use `pnpm test`, `pnpm typecheck`, and `pnpm lint` for their separate repository
guarantees; use `pnpm walk` only when the composed product is the question.
