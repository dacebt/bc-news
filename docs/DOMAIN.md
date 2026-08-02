---
type: doc
title: >-
  bc-news domain model
description: >-
  The binding domain vocabulary and identity rules for bc-news v2 — what an edition is, what identifies a generation run, and which domain questions remain deliberately open for planning.
tags: [documentation, domain, vocabulary, editions]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-02T22:26:59Z"
authority: binding
---

# bc-news domain model

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. This
document distills and fixes the domain language of the
[product requirements](PRD.md); it does not add requirements. Use these terms
verbatim in code, schema, tests, and APIs — no synonyms.

## Vocabulary

- **region** — a BitCraft game region whose community chat is the raw
  material for a newspaper. Chat reaches us through **BitJita**, the
  third-party community API for BitCraft data.
- **active region** — a region currently designated to receive a daily
  newspaper. Approximately 10 exist today; up to 24 as BitCraft expands. The
  authoritative source of the active-region list is an open decision (see
  below); it is not this document and not a hardcoded copy of the
  predecessor's list.
- **publication date** — the calendar date an edition is published under.
  Together with an active region it identifies exactly one intended edition.
- **edition** — the newspaper product: one complete, publishable daily paper
  for one active region and one publication date, built from that region's
  validated chat activity.
- **generation run** — the work that produces one edition: one instance of
  the single Cloudflare Workflow definition, invoked for one active region
  and one publication date.
- **editorial capability** — a distinct unit of editorial work inside a
  generation run whose model assignment is independently replaceable. The
  capability roster and each capability's degree of autonomy are open
  decisions.
- **ingest** — the process that collects regional chat messages from BitJita
  and validates them before they become edition evidence.
- **Actors**: the **reader** (a BitCraft player), the **operator** (who
  understands progress, failures, model usage, and cost without raw-log
  archaeology), and the **developer** (who reproduces generation locally from
  fixed conversations and compares changes before publishing).

## Identity rules

1. One active region + one publication date identify **one intended edition
   run**. There is never a second intended edition for the same pair.
2. Duplicate delivery or retry of a generation run must never publish a
   duplicate edition.
3. A generation run's failure is isolated to its region; other regions'
   editions proceed.
4. Completed generation work within a run is durable: it survives process
   termination, deployment, and later-step failure, and retries never repeat
   successful expensive work.

These four rules restate the invariant floor in the repo router; the full
required behavior lives in the [product requirements](PRD.md).

## Deliberately open domain questions

These are design decisions for planning, listed here so no implementation
resolves them silently. Settling one amends this document in the same unit of
work:

- The editorial capability roster and autonomy bounds.
- The canonical edition contract (structure of a published edition).
- The authoritative active-region source and the edition scheduling policy.
- The relationship between a publication date and the window of chat evidence
  it covers. The predecessor used a fixed one-expression contract
  (edition date minus one day — see the [v1 reference map](v1-reference.md));
  v2 has not adopted it.
- Missing-data, late-data, regeneration, and manual-control behavior.

## Links

- [Product requirements](PRD.md) — the binding source this vocabulary
  distills.
- [v1 reference map](v1-reference.md) — where the predecessor's observed
  domain behavior lives; reference, never authority.
