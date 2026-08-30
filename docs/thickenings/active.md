---
type: thickening
title: >-
  Thickening: focused coordinate references
description: >-
  Active WSD thickening for carrying chat-mentioned coordinates into generated newspaper links that open the exact focused BitCraft Map view.
tags: [wsd, thickening, active, generation, client, game-references]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-30T15:42:09Z"
---
# Thickening: focused coordinate references

**Started:** 2026-08-30
**Git strategy:** commit-to-main
**Cadence:** Loose

## Dimension

Code-owned game-reference links across the composed edition path.

## Observable delta

- before: coordinate syntax from public chat can remain opaque in generated newspaper prose and the client has no authorized link representation for it.
- after: bare and author-labeled coordinates can survive both editorial writers, remain retained with the edition, render as truthful newspaper links, and open the exact focused BitCraft Map view while arbitrary chat or model URLs remain inert.

## Minimum surface

- Coordinate-reference parsing, canonical identity, per-display `[[GAME_REF_NNN]]` presentation token, and exact `destination_url` rules in the functional generation core; bare and labeled forms for the same coordinate must remain independently truthful, with bare display normalized to `N <northing>, E <easting>`.
- Both runtime prompt builders and output parsers, preserving the existing untrusted-data fence and author-token authority boundary.
- Current edition contract, deterministic assembly, persistence/read compatibility, and generation status where the versioned contract requires it.
- Newspaper prose rendering that activates only references retained by code while keeping generic Markdown links disabled.
- Committed evidence fixtures whose valid bare, author-labeled, repeated, and completed-milestone forms are traceable to the retained public corpus, with same-coordinate/different-display, malformed, and URL-smuggling counterexamples clearly labeled as synthetic where the corpus has no observed example.
- Focused contracts, evaluation loading, the walk-owned recorded boundary and browser probe, and binding documentation required to observe the whole path.

## Verification path

- Run focused package contracts and the repository-wide typecheck and lint gates; the coordinate fixture must retain its exact identities and reject malformed or unauthorized destinations.
- After the required human checkpoint, run `pnpm --filter @bc-news/eval eval -- scratch run --fixture packages/fixtures/evidence/game-reference-links.json --config apps/eval/local-data/game-reference-links.lmstudio.json --results-dir /tmp/bc-news-game-reference-links-scratch` and the same command with fixture `packages/fixtures/evidence/game-reference-announcement-links.json` and results directory `/tmp/bc-news-game-reference-announcement-links-scratch`; inspect both writer outputs for preservation of the code-owned coordinate references.
- Invoke `ebt-wsd:skeleton-walker` with `--require-probe`; the repository-owned `pnpm walk -- --non-interactive` path must end in `WALK PASS`, and its browser probe must observe both a bare and author-labeled coordinate link with the exact fixed-host focused-map query while arbitrary Markdown remains non-clickable.

## Residual risks

- Non-invariant: the fixed map zoom can be less convenient for some locations even though the original coordinate remains exact.
- Non-invariant: author labels outside the observed bracketed form may remain ordinary prose until direct corpus evidence identifies another BitCraft reference form.

## Notes

Notify the user immediately before any local-model invocation. Do not run that command, inspect loaded models, or author the model configuration until the user responds at the checkpoint.

The fixture's public-message provenance source is the retained snapshot at `apps/eval/local-data/corpus-workspaces/production-grounded-2026-08-16/snapshot.sqlite`, not only the smaller checked-in reference-corpus extracts. That snapshot includes bare coordinate references and bracket-labeled coordinate references such as `[Fire Nation](coord=7968,9659)`; same-coordinate/different-display remains synthetic and must be labeled as such.

## Context

- [Current shape](../direction/2026-08-30-game-reference-links.shape.md) — governs cadence, scope, and success.
- [Capability map](../direction/2026-08-30-game-reference-links.map.md) — selects focused coordinates as the dependency-setting first capability.
- [Binding domain model](../DOMAIN.md) — owns public-message, edition, and editorial-product vocabulary.
