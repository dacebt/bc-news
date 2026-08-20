---
type: thickening
title: >-
  Thickening: editorial generation ownership
description: >-
  Active WSD thickening for publishing one complete edition through two final evidence-reading writers.
tags: [wsd, thickening, active]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-20T03:31:00Z"
---
# Thickening: editorial-generation-ownership

**Started:** 2026-08-19
**Git strategy:** commit-to-main
**Cadence:** Tight

## Dimension

Editorial generation ownership across the composed production and evaluation paths.

## Observable delta

- before: A generation run sends each evidence-reading writer's complete product through a second evidence-blind copyedit model, and the main writer is required to manufacture a day-wide throughline.
- after: Two evidence-reading writers file final structured copy; the main writer turns any ordinary or consequential public-chat moment into proportionately sized in-world reporting, and code owns validation, representation cleanup, assembly, and non-creative edition data.
- boundary: If preparation hygiene produces zero messages, the run takes the existing no-evidence failure path before either writer. With at least one prepared message, every successful writer-output path produces the structured main story; there is no editorial abstention or no-story result, while infrastructure and model-contract failures remain terminal.

## Minimum surface

- Editorial prompt builders, strict output schemas, string normalization, diagnostics, and edition assembly.
- Production-step vocabulary, provider configuration, run status, retries, usage, and provenance.
- Recorded responses, generation fixtures, the composed walker, and current evaluation execution and artifacts.
- Historical evaluation readers for retained four-step evidence.
- Explicit current edition and generation-status versioning plus legacy-only readers for untagged stored records.
- Binding product, architecture, domain, testing, and decision documentation.

## Verification path

Run `pnpm typecheck`, `pnpm test`, and `pnpm lint`; prove that raw chat reduced to zero prepared messages fails before inference; then run `pnpm walk -- --non-interactive` and observe a published `EditionSchema` product assembled from exactly two ordered recorded writer invocations. Before acceptance, review the exact runtime prompt wording with the user and run a representative local-model evaluation in which a small public exchange becomes a structured headline, lede, and body without asserted invented concrete outcomes.

## Residual risks

- Non-invariant: historical V7/V8 scorecard readers may retain four-role terminology even though all newly produced evaluation evidence uses the two-writer topology.
- Non-invariant: provider-specific prose quality can still vary after the shared prompt behavior is established and observed on the selected local model.

## Notes

The approved seam removes both copyedit calls rather than leaving inactive configuration. The main-story output retains separately structured headline, lede, and body. No hosted inference, deployment, production access, push, or publication is authorized.

Newly assembled editions and newly written generation-status projections carry explicit current contract versions. Stored records without the applicable discriminator are parsed only by their complete legacy schemas, preventing a truncated legacy edition or a partial old run from being accepted as current two-writer data.

## Context

- [Editorial generation ownership shape](/docs/direction/2026-08-19-editorial-generation-ownership.shape.md) — governs cadence, scope, and success.
- [Operational domain model](/docs/direction/bc-news.model.md) — preserves evaluation vocabulary and historical-reader distinctions.
- [Binding domain model](/docs/DOMAIN.md) — owns production editorial-product and production-step vocabulary.
