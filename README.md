# bc-news

`bc-news` is a Cloudflare-native rebuild of the daily regional newspaper for
the BitCraft community. Validated BitJita chat activity becomes one durable,
complete edition per active region and publication date.

**Status: walking skeleton.** The composed local product path runs end to end
with committed conversation and recorded-model fixtures.

## Quickstart

Prerequisites: Node 22+, pnpm, and an installed Chrome browser. Dependency
installation can use the network; after dependencies are present, the walk
uses only localhost, local Cloudflare emulation, and committed fixtures.

```sh
pnpm install
pnpm walk
```

The walk builds the workspace, migrates an isolated temporary D1 database,
starts a BitJita HTTP stub, then runs the ingest and generation Workers through
two local Wrangler processes. Generation uses `WALK_PORT` (default `8787`) and
ingest uses the next port; both ports must be free. The assertions cover the operator boundary,
scheduled ingest and generation, an isolated sibling failure, durable
publication, the edition and status APIs, idempotent replay, and browser parity.
Success ends with `WALK PASS`.

The default command holds the local product open for inspection; press Ctrl-C
to stop. Use `pnpm walk --non-interactive` or `WALK_NON_INTERACTIVE=1` to shut
down after the assertions. The walk never authors fixtures or contacts a live
model endpoint.

## Documentation authority

Start with the [documentation index](docs/index.md). It routes the complete OKF
documentation bundle and states which documents are binding or descriptive.

- [Product requirements](docs/PRD.md) — binding product direction.
- [Domain model](docs/DOMAIN.md) — binding vocabulary and identity rules.
- [Structural discipline](docs/ARCHITECTURE.md) — binding architecture posture.
- [Test and verification posture](docs/TESTING.md) — binding evidence discipline.
- [Evaluation operations](docs/evaluation-operations.md) — descriptive command and artifact guide.
- [Model admission and pricing](docs/model-pricing.md) — descriptive current model register and mutable price sources.
- [v1 reference map](docs/v1-reference.md) — descriptive map of the frozen predecessor.

## Command index

Each evidence surface owns its outcome. See [evaluation operations](docs/evaluation-operations.md)
for arguments, artifact locations, and interpretation boundaries.

| Question | Command |
|---|---|
| Do deterministic invariants hold? | `pnpm test` |
| Do static guarantees hold? | `pnpm typecheck` and `pnpm lint` |
| Does one disposable live configuration complete the four production steps? | `pnpm --filter @bc-news/eval eval -- scratch run ...` |
| What behavior did a declared model benchmark retain? | `pnpm --filter @bc-news/eval eval -- benchmark run/list/show/summary/compare ...` |
| What source corpus, scorecard, aggregate, or longitudinal evidence exists? | `pnpm --filter @bc-news/eval eval -- corpus ...`, `scorecard ...`, `aggregate ...`, or `longitudinal ...` |
| Can a live four-step response set be recorded, or context measured? | `pnpm --filter @bc-news/eval eval -- fixture record-responses ...` and `context benchmark ...` |
| Do committed recorded responses replay deterministically? | `pnpm --filter @bc-news/eval eval -- acceptance run --fixture packages/fixtures/evidence/active-region-7_2026-01-24.json` |
| Does the composed local product run end to end? | `pnpm walk` |

Deterministic tests, model experiments, retained evaluation artifacts,
recorded-replay acceptance, and the composed walk are separate evidence
domains; no result silently substitutes for another.
