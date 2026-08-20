---
type: doc
title: >-
  bc-news domain model
description: >-
  The binding domain vocabulary and identity rules for bc-news v2, including the two editorial products and two production model steps.
tags: [documentation, domain, vocabulary, editions]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:54:00Z"
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
  newspaper. Thirteen are active today (BitJita's current verified list); up
  to 24 as BitCraft expands. The list's starting content is inherited (see
  Defaults); its authoritative *home* is settled as
  `packages/contracts/src/active-regions.ts` (see
  [ARCHITECTURE.md](ARCHITECTURE.md)) — not this document, and not two hand-synced
  hardcoded copies as in v1.
- **publication date** — the calendar date an edition is published under.
  Together with an active region it identifies exactly one intended edition.
- **evidence date** — the calendar day of chat an edition draws on: the
  publication date minus one day (the inherited v1 date contract, see
  Defaults). Always derived from a publication date through the one date
  function in code; never supplied independently.
- **edition** — the newspaper product: one complete, publishable daily paper
  for one active region and one publication date, built from that region's
  validated chat activity.
- **generation run** — the work that produces one edition: one instance of
  the single Cloudflare Workflow definition, invoked for one active region
  and one publication date.
- **editorial product** — one reader-facing part of an edition. The two
  products are `main_story` (title plus the main story's headline, lede, and
  body) and
  `announcements` (the ordered announcement list).
- **production model step** — one independently configured model call inside
  a generation run. The exact ordered roster is `main_story_write` and
  `announcements_write`.
- **writer** — the evidence-reading step for one editorial product. Writers
  file final structured copy; code validates it, normalizes unambiguous
  decoded strings, assembles the edition, and supplies non-creative fields.
- **editorial diagnostic** — a retained non-terminal preservation or
  final-product finding on schema-valid writer output. Infrastructure and
  model-output contract failures remain terminal instead.
- **context benchmark** — an eval-only measurement of the exact four
  production requests against one already-loaded local Qwen model. It reports
  model-template input, evidence or draft marginal, runtime delta, completion,
  total, and remaining context at fixed prepared-message loads. It is evidence
  for later design choices, never an evidence-policy change itself.
- **model evaluation** — observation and retention of model behavior on
  declared inputs, including behavior that production rejects. It is not an
  acceptance decision or a skeleton walk.
- **benchmark run** — one declared model-evaluation experiment: fixture,
  prepared evidence, exact configuration matrix, repetitions, evaluation
  trials, provenance, and harness outcome.
- **evaluation trial** — one declared configuration and repetition evaluated
  against one fixture across the independent `main_story` and `announcements`
  tracks.
- **step invocation** — one actual provider request for one production model
  step, including its exact request, completion or transport failure, timing,
  parse state, findings, and retry linkage.
- **subject outcome** — the typed model behavior observed by an evaluation
  trial: completed, a named rejection, or infrastructure-incomplete.
- **harness outcome** — whether evaluation retained trustworthy evidence. A
  subject rejection can coexist with a retained harness outcome.
- **evaluation finding** — a structured, step-attributable invalid-JSON,
  contract, preservation, or final-product observation; never a quality score
  or judge verdict.
- **ingest** — the process that collects regional chat messages from BitJita
  and validates them before they become edition evidence.
- **Actors**: the **reader** (a BitCraft player), the **operator** (who
  understands progress, failures, model usage, and cost without raw-log
  archaeology), and the **developer** (who reproduces generation locally from
  fixed conversations and compares changes before publishing).

## Identity rules

1. One active region + one publication date identify **one intended generation
   run**. There is never a second intended edition for the same pair.
2. Duplicate delivery or retry of a generation run must never publish a
   duplicate edition.
3. A generation run's failure is isolated to its region; other regions'
   editions proceed.
4. Completed generation work within a run is durable: it survives process
   termination, deployment, and later-step failure, and retries never repeat
   successful expensive work.

These four rules restate the invariant floor in the tracked [product
requirements](PRD.md), which own the full required behavior.

## Defaults

**v1's observed behavior is the default answer to every product-behavior
question.** v2 changes structure, not product. The reference for what v1
did is the [v1 reference map](v1-reference.md); deviations happen only
where the new structure forces them or a recorded decision changes them,
and each deviation amends this document in the same unit of work.

Inherited defaults until deliberately changed:

- The edition contract starts from v1's published edition shape.
- The active regions are BitJita's current 13, superseding v1's nine, with the
  list's authoritative home a structural choice, not a product one.
- A publication date covers the prior day's chat (publication date minus one
  day). The covered day is the *evidence date*.
- Missing-data and availability behavior follow what v1 observably did.
- The edition contract carries v1's reader-facing shape with these settled
  deviations: identity fields use the domain terms (`active_region_id`,
  `publication_date`); current edition and generation-status records carry
  explicit contract discriminators and stored untagged records are legacy-only
  readers; `meta.editorial_products` records writer provenance under each
  editorial product; provider is an open string so local and recorded models
  are representable; `meta` is required at publish and read; identity,
  provenance, counts, and generation time are never model-authored.
- The main-story writer authors the edition title and main story. The
  announcements writer authors the announcement list. Code deterministically
  assembles all remaining edition fields. There is no packaging, judging, or
  copyedit model step in the current production shape.
- If evidence preparation ends with `final_count === 0`, the run fails before
  inference. With at least one prepared message, schema-valid writer output
  continues to publication with no abstention/no-story branch.

## Links

- [Product requirements](PRD.md) — the binding source this vocabulary
  distills.
- [v1 reference map](v1-reference.md) — where the predecessor's observed
  domain behavior lives; reference, never authority.
