---
type: doc
title: >-
  v1 reference map
description: >-
  Descriptive map of the frozen predecessor repos — which copies to read, where the proven ingest, prompt, schema, and client material lives, and what made v1's orchestration fragile.
tags: [documentation, reference, v1, predecessor]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-02T22:26:59Z"
authority: descriptive
---

# v1 reference map

Descriptive, written from a verified survey of the frozen repos on
2026-08-02. Reference material only: per the [product requirements](PRD.md)
rebuild boundaries, v2 never migrates v1 data, preserves its accidental
internals, or modifies it. Paths are sibling-relative to this repo's parent
directory.

## Which copies to read

**`bc-news-worker` is a monorepo that absorbed the other two v1 repos.**
`bc-newspaper` is byte-identical to or behind `bc-news-worker/apps/newspaper/`;
the Python `bc-news-eval` was ported to `bc-news-worker/apps/eval/`
(TypeScript, 2026-07-17) with identical fixtures and a *newer* judge prompt.
**Always read the monorepo copies.** Last commits: `bc-news-worker` `94b5174`
(2026-07-30), `bc-news-eval` `2de016c` (2026-02-04), `bc-newspaper` `a02f795`
(2026-02-27).

v1 shape: pnpm/Turbo monorepo, TypeScript, two Cloudflare Workers
(`apps/ingest`, `apps/generator`), React/Chakra SPA (`apps/newspaper`), eval
CLI (`apps/eval`), shared `packages/types` (zod v4) and `packages/prep`.
D1 was the only stateful binding — no Queues, Workflows, KV, R2, or Durable
Objects anywhere in v1.

## Highest-signal reading, in order

1. `bc-news-worker/.docs/ARCHITECTURE_DISCIPLINE.md` — six principles
   extracted from the v1 codebase with exemplars and named violations.
   (`.docs/` is tracked; the worker's `docs/` is gitignored.)
2. `bc-news-worker/apps/generator/src/db.ts` (roughly lines 307–610) — the
   lease/fencing/publish machinery: claim with lease TTL and crash reclaim,
   every mutating write fenced on run version + state + lease owner,
   generation number as a retry epoch.
3. `bc-news-worker/apps/generator/src/llm/prompts.ts` — the editorial voice
   (in-world regional news, dry wit, no winking at the reader, bold reserved
   for player names). This is product, worth carrying near-verbatim.

## Where the preserve-as-knowledge material lives

- **Ingest lessons** — `bc-news-worker/apps/ingest/src/`: monotonic
  compare-and-set cursor (`db.ts`), evidence-derived poll outcomes and a
  watermark that only advances over rows offered to storage (`poller.ts`),
  boundary rejection over coercion (`mapping.ts`, `parsers.ts`),
  no-silent-default config (`config.ts`). Ingest had no backoff — the
  every-minute cron was the retry.
- **Date contract** — one expression: messages date = edition date minus one
  day, at `bc-news-worker/apps/generator/src/utils.ts:88`. v2's equivalent is
  an open decision in the [domain model](DOMAIN.md).
- **Prompts** — production template literals in
  `apps/generator/src/llm/prompts.ts`; eval YAML and judge rubrics in
  `apps/eval/prompts/` and `apps/eval/src/eval-judge/rubrics.ts`. Trap: the
  production and eval prompt texts were two hand-maintained copies with
  nothing enforcing parity.
- **Orchestration schema** —
  `bc-news-worker/migrations/0005_runs_events_artifacts.sql` (runs unique per
  region + date, append-only run events, versioned artifacts as the durable
  inter-step handoff) and `0007_add_artifact_generations.sql`.
- **Edition contract** — `bc-news-worker/packages/types/src/edition.ts`
  (strict zod `EditionOutputSchema`); read the `.partial({meta})` comment in
  `apps/generator/src/edition-document.ts` before designing v2's boundary.
  One public route existed: `GET /api/edition?region_id=&date=`, with a
  deliberate 500 `edition_unreadable` distinct from 404.
- **Client identity** — ~250 transportable lines: the paper palette
  (`apps/newspaper/src/theme/index.ts:18-24`), `PaperSurface.tsx`,
  `styles/paperTexture.ts`, and the masthead/drop-cap/two-column CSS inside
  `pages/EditionPage.tsx`. The "Frozen UI Architecture Rules" section of
  `bc-newspaper/CLAUDE.md` reads as a design brief for v2.
- **Active regions** — hardcoded in two places that had to agree by hand:
  `apps/generator/src/queue.ts` and
  `apps/newspaper/src/config/regions.ts`, both
  `["7","8","9","12","13","14","17","18","19"]`. No ownership or settlement
  attribution exists anywhere in v1.

## Why v1 was fragile

The pipeline was seven steps (count messages → prep → three LLM stages →
validate → publish) advanced one step per cron tick to dodge Worker limits:
7 steps × 9 regions = 63 ticks needed per day against 48 declared cron ticks
— the budget was never reconciled. The generator's `scheduled()` swallowed
all errors; the admin generate route ran the whole pipeline in one HTTP
request; publish was a non-atomic D1 batch; admin routes were
unauthenticated. This is precisely what the PRD's
one-Workflow-instance-per-region-and-date design replaces.

## At-risk evidence (gitignored, local-disk only)

- `bc-news-eval/eval_results/` — 37 runs, the only surviving record of v1
  model comparisons (single copy, in no git remote).
- Fixtures (8.4 MB: three captured chat days + 27 prep outputs) — gitignored
  but duplicated across both eval trees.
- `bc-news-worker/docs/` — gitignored; includes `CONTRACT.md` (time semantics
  and schema prose) and `DEBUGGING_NOTES.md`.

Do not read or copy local `.env` files in the v1 repos; they contain live
provider credentials and are not reference material.

## Documentation traps in v1

Trust code over prose: v1 docs still describe an empty `services/` directory
(code lives in `apps/`); `apps/eval/CLAUDE.md` documents the deleted Python
CLI; `docs/OVERVIEW.md` describes a superseded three-role editorial design
whose dead `JOURNALIST_*` / `EDITOR_*` vars linger in `.dev.vars`.

## Links

- [Product requirements](PRD.md) — the rebuild boundaries that make this
  material knowledge, not substrate.
- [Domain model](DOMAIN.md) — the binding v2 vocabulary; v1 terms do not
  override it.
