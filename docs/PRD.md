---
type: doc
title: >-
  bc-news v2 product requirements
description: >-
  Binding high-level product direction for rebuilding the regional BitCraft newspaper on Cloudflare with durable generation, replaceable models, and evaluation-led development.
tags: [product, requirements, bitcraft, cloudflare, llm]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:54:00Z"
authority: binding
---

# bc-news v2 product requirements

If implementation and this document disagree, the implementation is wrong unless this document is deliberately amended in the same unit of work.

## Product

`bc-news` publishes a daily newspaper for each active BitCraft region. It turns the region's recent BitJita chat activity into an engaging edition that helps players understand what happened in their community without reading the full conversation history.

This is a clean rebuild of the frozen [`bc-news-worker` prototype](https://github.com/dacebt/bc-news-workers). The predecessor remains an executable reference for proven behavior and lessons; v2 does not inherit its implementation, deployment configuration, database history, or accidental constraints.

## Why rebuild

The prototype proved that regional chat can become a useful newspaper, but its generator orchestration, deployment transition, and local testing model made reliable iteration difficult. The rebuild must make newspaper quality easier to improve, model choices easier to change, and each regional edition independently recoverable when an external model call fails.

## Users

- **BitCraft players** read a useful, entertaining regional newspaper.
- **The operator** can understand edition progress, failures, model usage, and cost without reconstructing events from raw logs.
- **The developer** can reproduce generation locally from fixed conversations and compare changes before publishing them.

## Product goals

1. Publish one edition for every active region on the intended daily cadence.
2. Support all active regions — 13 today per BitJita's current verified list — and up to 24 as BitCraft expands.
3. Preserve the proven ingest behavior while allowing contract and efficiency improvements required by the new generator.
4. Rebuild generation around one durable, inspectable Workflow definition that is invoked separately for each active region and publication date, so no server process must remain alive across the entire newspaper build.
5. Allow the model used by each production model step to be changed without redesigning the whole generation process.
6. Support low-cost hosted models, occasional frontier-model trials, and local LLMs during development.
7. Preserve the useful client experience while allowing its contracts and presentation to evolve with the generated edition.
8. Make evaluation part of development: representative conversations, comparable outputs, and retained evidence should guide prompt, model, and orchestration changes.
9. Keep routine operating cost appropriate for a side project.

## Product flow

1. Ingest collects and validates regional chat messages from BitJita.
2. The system identifies each active region that needs an edition.
3. One instance of the generation Workflow builds one region's edition for one publication date.
4. Two writer-to-copyedit tracks produce the main-story and announcements editorial products.
5. Code validates those products and assembles the edition without another model call.
6. The completed edition becomes available to the client.
7. The client presents published regional newspapers to readers.

The settled production model steps are `main_story_write`,
`main_story_copyedit`, `announcements_write`, and
`announcements_copyedit`. Each copyeditor is a narrow cleanup pass over its
own track's typed draft, not a story judge or another evidence-reading editor.

## Required behavior

### Regional isolation

- A failure for one region must not prevent other regions from publishing.
- A region and publication date identify one intended generation run.
- Duplicate delivery or retry must not publish duplicate editions.

### Durable generation

- Completed generation work must survive process termination, deployment, and later-step failure.
- A failed step must resume or retry without unnecessarily repeating successful expensive work.
- Failures must not create uncontrolled repeated model spending.

### Model flexibility

- Models must be replaceable independently across the four production model steps.
- Both hosted and local LLMs must be usable during development and evaluation.
- Routine inference cost must remain understandable.
- Model access protocols and integration layers are settled in the
  [structural discipline](ARCHITECTURE.md); the first live production model
  configuration, fallback policy, and any additional telemetry remain open
  product decisions.

### Evaluation-led development

- The repository must contain a small, representative set of conversation fixtures that can be replayed locally.
- Prompt, model, and orchestration changes must be comparable on the same inputs, with evidence retained over time.
- The repository-owned evaluation tool may export strict aggregate result JSON from validated scorecards for commit-safe comparison, retaining only descriptive role summaries and never choosing a winner, declaring acceptance, or selecting production models.
- Local models, recorded responses, and provider free tiers should be preferred for routine development.
- Paid evaluation SaaS, scheduled live candidate evaluations, and a recurring model-tuning budget are not required.

### Reader experience

- The v2 client reproduces the prototype's deployed reading experience at full UI/UX parity; deviations are permitted only where the new edition contract forces them.
- Client contracts may change when the new generator establishes a better edition representation.
- Readers navigate by active region and publication date through URL-addressed
  controls, browser history restores prior selections, and unavailable editions
  render an explicit state.

## Platform and cost constraints

- Cloudflare is the accepted primary platform and vendor lock-in is acceptable for this project.
- The initial deployment targets the Cloudflare Workers Free plan. Upgrade to Workers Paid only when observed limits or operational needs justify it.
- Cloudflare Cron Triggers and one Cloudflare Workflow definition are the
  delivery and durable-execution foundation. The generation Cron invokes a
  separate Workflow instance for each active region and publication date; no
  Queue sits between the trigger and Workflow launch.
- Static client delivery remains on Cloudflare.
- The historical operator estimate of the predecessor's inference cost —
  roughly $1.00–$1.25 per month — is the baseline to beat or justify exceeding.
- Recurring paid infrastructure or evaluation services require an explicit product decision rather than entering by default.

## Rebuild boundaries

### Preserve as knowledge

- The purpose and observable behavior of ingest.
- Hard-won cursor, validation, retry, ownership, date, and publication lessons.
- Useful client interactions and visual identity.
- Prompts, fixtures, schemas, tests, and evaluation findings that express proven behavior.

### Replace freely

- Generator orchestration and editorial-role design.
- Database schema and migrations.
- Service and package boundaries.
- Deployment configuration.
- Model-provider integration code.
- Local development and evaluation tooling.

### Explicit non-goals

- Migrating legacy conversations, editions, or operational state.
- Maintaining backward compatibility with the prototype's internal APIs or database.
- Repairing or extending the frozen prototype as the v2 implementation.
- Operating a paid continuous model-evaluation program.

## Success signals

- A fixed local conversation can produce and render a complete edition end to end without production data.
- Every active region's edition — 13 today, later up to 24 — runs through the same Workflow definition as a separate instance without requiring one long-lived server invocation.
- An interrupted generation resumes from durable completed work.
- Replaying the same evaluation inputs makes prompt and model changes meaningfully comparable.
- Models can be changed per production model step without rewriting the workflow.
- Routine production cost remains close to the predecessor unless measured quality gains justify a deliberate increase.
- Readers continue receiving a useful regional newspaper throughout regional growth.

## Remaining product decisions

The build has settled the edition contract, active-region authority and
scheduling, storage topology, provider integrations, client navigation and
availability behavior, and repository deployment topology in the
[domain model](DOMAIN.md) and [structural discipline](ARCHITECTURE.md). The
following product decisions remain open; the prototype's observed behavior is
still the default answer where it applies.

- Whether a later evidence-research capability needs bounded agent autonomy. It is not part of the current four-step editorial workflow.
- The first live production model configuration and fallback policy.
- Late-data and regeneration policy beyond the settled explicit no-evidence
  failure and authenticated pair-addressed manual launch.
- Retention durations for Workflow state, evaluation artifacts, and operational
  records; their persistence and storage homes are settled.
- Any additional production observability or telemetry beyond pair-addressed
  run status and retained model usage, billing, provenance, and diagnostics.

## Provenance and navigation

- This PRD succeeds the [`bc-news-worker` source repository](https://github.com/dacebt/bc-news-workers) as product direction; it does not modify or reactivate that frozen implementation.
- Navigate this OKF bundle through the [documentation index](index.md).
