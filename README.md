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
starts `wrangler dev`, then proves the tier-1 skeleton sequence:

- triggering a generation run for the fixture pair (active region 7,
  publication date 2026-01-25) is accepted, and `/api/edition` serves an
  edition that parses against the shared edition schema;
- re-triggering the same pair never produces a second edition — the
  served edition is byte-identical, and the duplicate signal is recorded;
- an unknown pair answers 404, and the client HTML serves from the same
  origin.

On success it prints `WALK PASS` plus the edition URL and holds
`wrangler dev` so a browser can observe the rendered paper — Ctrl-C to
stop. `pnpm walk --non-interactive` (or `WALK_NON_INTERACTIVE=1`) shuts
down after the assertions instead; the exit code reflects the assertions
either way. On timeout the walk prints the generation run's status.
`WALK_PORT` overrides the port `wrangler dev` binds to (default `8787`).

Where authority lives:

- [CLAUDE.md](CLAUDE.md) — the router: canonical docs, invariant floor,
  vocabulary, documentation discipline. Read it first.
- [docs/index.md](docs/index.md) — the documentation bundle root.
- [docs/PRD.md](docs/PRD.md) — binding product requirements.
- [docs/DOMAIN.md](docs/DOMAIN.md) — binding domain vocabulary.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — binding structural discipline.
- [docs/TESTING.md](docs/TESTING.md) — binding evidence discipline.

The frozen v1 (`bc-news-worker` and siblings, in the parent directory) is
reference material only — see the [v1 reference map](docs/v1-reference.md).
