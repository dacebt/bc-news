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
  at: "2026-08-03T12:52:42Z"
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
2. Support all active regions — nine today per the verified v1 list — and up to 24 as BitCraft expands.
3. Preserve the proven ingest behavior while allowing contract and efficiency improvements required by the new generator.
4. Rebuild generation around one durable, inspectable Workflow definition that is invoked separately for each active region and publication date, so no server process must remain alive across the entire newspaper build.
5. Allow the model used by each editorial capability to be changed without redesigning the whole generation process.
6. Support low-cost hosted models, occasional frontier-model trials, and local LLMs during development.
7. Preserve the useful client experience while allowing its contracts and presentation to evolve with the generated edition.
8. Make evaluation part of development: representative conversations, comparable outputs, and retained evidence should guide prompt, model, and orchestration changes.
9. Keep routine operating cost appropriate for a side project.

## Product flow

1. Ingest collects and validates regional chat messages from BitJita.
2. The system identifies each active region that needs an edition.
3. One instance of the generation Workflow builds one region's edition for one publication date.
4. That generation run turns regional evidence into a publishable newspaper through editorial capabilities defined during build planning.
5. The completed edition becomes available to the client.
6. The client presents published regional newspapers to readers.

The exact editorial roles, their degree of autonomy, and their model assignments are design decisions for the rebuild rather than requirements fixed here.

## Required behavior

### Regional isolation

- A failure for one region must not prevent other regions from publishing.
- A region and publication date identify one intended edition run.
- Duplicate delivery or retry must not publish duplicate editions.

### Durable generation

- Completed generation work must survive process termination, deployment, and later-step failure.
- A failed step must resume or retry without unnecessarily repeating successful expensive work.
- Failures must not create uncontrolled repeated model spending.

### Model flexibility

- Models must be replaceable independently across editorial capabilities.
- Both hosted and local LLMs must be usable during development and evaluation.
- Routine inference cost must remain understandable.
- Model access protocols, integration layers, and detailed telemetry are design decisions for build planning.

### Evaluation-led development

- The repository must contain a small, representative set of conversation fixtures that can be replayed locally.
- Prompt, model, and orchestration changes must be comparable on the same inputs, with evidence retained over time.
- Local models, recorded responses, and provider free tiers should be preferred for routine development.
- Paid evaluation SaaS, scheduled live candidate evaluations, and a recurring model-tuning budget are not required.

### Reader experience

- The v2 client reproduces the prototype's deployed reading experience at full UI/UX parity; deviations are permitted only where the new edition contract forces them.
- Client contracts may change when the new generator establishes a better edition representation.
- Edition history, navigation, and unavailable-state behavior are design decisions for build planning.

## Platform and cost constraints

- Cloudflare is the accepted primary platform and vendor lock-in is acceptable for this project.
- The initial deployment targets the Cloudflare Workers Free plan. Upgrade to Workers Paid only when observed limits or operational needs justify it.
- Cloudflare-native Queues and one Cloudflare Workflow definition are the preferred delivery and durable-execution foundation. The Workflow is invoked separately for each active region and publication date.
- Static client delivery remains on Cloudflare.
- The predecessor's observed inference cost of roughly $1.00–$1.25 per month is the baseline to beat or justify exceeding.
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
- Every active region's edition — nine today, later up to 24 — runs through the same Workflow definition as a separate instance without requiring one long-lived server invocation.
- An interrupted generation resumes from durable completed work.
- Replaying the same evaluation inputs makes prompt and model changes meaningfully comparable.
- Models can be changed per editorial capability without rewriting the workflow.
- Routine production cost remains close to the predecessor unless measured quality gains justify a deliberate increase.
- Readers continue receiving a useful regional newspaper throughout regional growth.

## Decisions intentionally left for kickoff

For every product-behavior item below, the prototype's observed behavior is
the default answer; kickoff decides structure and deliberate deviations, not
product from scratch.

- The editorial capability roster and whether any capability needs bounded agent autonomy.
- The first production model configuration and fallback policy.
- The canonical edition contract. (Client parity is settled: full UI/UX parity minus contract-forced changes.)
- The authoritative source for active regions and edition scheduling policy.
- Missing-data, late-data, regeneration, and manual-control behavior.
- Persistence, storage, and artifact-retention choices.
- Model-provider access, integration, fallback, and concurrency behavior.
- Operational observability and telemetry detail.
- Client history, navigation, and unavailable-state behavior.
- The local runner and deployment topology. (Language and package layout are settled: TypeScript throughout, v1's monorepo shape.)
- The evaluation result format and whether a local tool is useful beyond a repository-owned harness.

## Provenance and navigation

- This PRD succeeds the [`bc-news-worker` source repository](https://github.com/dacebt/bc-news-workers) as product direction; it does not modify or reactivate that frozen implementation.
- Navigate this OKF bundle through the [documentation index](index.md).
