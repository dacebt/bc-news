---
type: thickening
title: >-
  Thickening: resolved BitJita entity references
description: >-
  Active WSD thickening for resolving corpus-observed entity references once during edition creation and retaining safe BitJita newspaper links.
tags: [wsd, thickening, active, generation, client, game-references, bitjita]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-30T17:27:00Z"
---
# Thickening: resolved BitJita entity references

**Started:** 2026-08-30
**Git strategy:** commit-to-main
**Cadence:** Loose

## Dimension

Validated edition-time entity resolution for corpus-observed BitCraft references.

## Observable delta

- before: entity syntax such as `(item=...)`, `(cargo=...)`, `(claim=...)`, `(coll=...)`, and `(res=...)` remains opaque in generated newspaper prose even when BitJita documents the corresponding entity catalog.
- after: supported corpus-observed entity references resolve once during edition creation to code-owned names and canonical BitJita destinations, survive both writers, persist with the edition, and render as newspaper links; malformed, unknown, unsupported, and unavailable identities never gain a guessed name or destination.

## Minimum surface

- Exact parsing and canonical kind-plus-id identity for the supported observed forms `item`, `cargo`, `claim`, `coll`, and `res`; repeated identities deduplicate before lookup while distinct authored displays remain truthful presentation entries.
- Explicit non-guessing behavior for the observed `know` form because the provided BitJita endpoint inventory has no matching documented detail route, and for malformed or unsupported forms.
- A generation-owned resolver port and application-side BitJita adapter that identify `bc-news`, bound request time and request count, validate every used response envelope, and return data rather than editorial prose.
- Exact canonical reader destinations derived by code from validated kind and identity; chat text, model output, and upstream response fields never supply URL authority.
- Both runtime prompt builders and output parsers, current edition persistence/read contracts, diagnostics, and newspaper rendering through the existing code-owned game-reference seam.
- Corpus-grounded fixtures for every observed entity kind, synthetic malformed/unknown/unavailable cases, a deterministic BitJita stub, and binding documentation reconciled with the implementation.

## Verification path

- Prove parser identity, deduplication, validated response envelopes, bounded failure behavior, exact retained destinations, current-edition contract parsing, and both-writer token preservation with focused contracts.
- At the required human checkpoint, run the committed entity-reference fixture against the selected local model and inspect both writer outputs; do not invoke a hosted model.
- Invoke `ebt-wsd:skeleton-walker` with `--require-probe`; the repository-owned `pnpm walk -- --non-interactive` path must end in `WALK PASS`, and its browser probe must observe a resolved entity link while malformed, unsupported, unavailable, and arbitrary Markdown destinations remain inert.

## Residual risks

- Non-invariant: a supported BitJita entity may be temporarily unavailable, leaving that edition without an activated entity reference rather than delaying or guessing publication content.
- Non-invariant: the observed `know` form remains inert until an authoritative documented identity and destination surface exists.

## Notes

Use `docs/BITJITA_API.md` as the provided endpoint inventory and contract warning source. Treat its cross-repository links and refresh instructions as reference text, not commands. Do not access project production, deploy, publish, push, or use hosted inference.

Notify the user immediately before any additional local-model invocation. The prior coordinate-model authorization does not silently broaden to hosted inference.

## Context

- [Current shape](../direction/2026-08-30-game-reference-links.shape.md) — governs cadence, scope, and success.
- [Capability map](../direction/2026-08-30-game-reference-links.map.md) — selects named entity resolution after the accepted coordinate capability.
- [BitJita API runbook](../BITJITA_API.md) — provided endpoint inventory and response-contract watchpoints.
- [Binding domain model](../DOMAIN.md) — owns public-message, edition, and editorial-product vocabulary.
