---
type: capability-map
title: >-
  Capability map: game-reference links
description: >-
  Risk-ordered vertical capabilities and feature conventions for safe game-reference links in newspaper editions.
tags: [wsd, direction, capability-map, generation, client, bitjita, game-references]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-30T15:42:09Z"
---
# Capability map: game-reference links

**Declared:** 2026-08-30
**Domain model:** [binding domain model](../DOMAIN.md); the WSD evaluation model does not own game-reference vocabulary

## New conventions

- A game-reference identity always retains its kind with its value; a numeric identifier alone is never canonical.
- Canonical identity and presentation tokens are separate: references to the same identity retain distinct deterministic tokens whenever their author-visible display differs, while only identical authored forms may reuse a token.
- A presentation token is serialized as `[[GAME_REF_NNN]]`, where the one-based ordinal is zero-padded to at least three digits and assigned by the first stable evidence occurrence of each unique kind, value, and authored display form within an edition.
- A retained coordinate entry uses the exact fields `token`, `kind`, `northing`, `easting`, `display_text`, and `destination_url`; `destination_url` must equal `https://bitcraftmap.com/?center=<northing>,<easting>&zoom=3.0` as constructed by code.
- Only code-owned reference identities and destinations retained with an edition may create newspaper links; raw chat syntax and model-authored Markdown never carry URL authority.
- Entity display names resolve once during edition creation, while reader rendering performs no external lookup.
- Author-provided coordinate labels remain visible; a bare coordinate displays as `N <northing>, E <easting>` and links to the fixed focused-map destination without local coordinate conversion.
- BitJita requests identify `bc-news`, validate every response envelope before use, and deduplicate repeated reference identities before lookup.
- Corpus-derived valid examples and synthetic malformed or adversarial examples are labeled separately in committed fixtures.

## Capabilities

1. **A reader follows a chat-mentioned location from generated newspaper prose to the exact focused BitCraft Map view.** — Establishes the secure retained-reference path through prompts, the edition contract, and client rendering without depending on an entity API.
2. **A reader follows a named chat-mentioned entity from generated newspaper prose to its canonical BitJita detail page.** — Reuses the secure path while adding the validated, rate-bounded external lookup boundary for every observed entity kind.

## Order rationale

The composed acceptance spine already walks. Coordinates establish the dependency-setting code-owned link path with a deterministic destination; entity resolution then adds the higher-variance BitJita boundary without changing link authority.

## Notes

Prompt behavior is verified within each capability. The new local-model fixture is evidence for the actor-visible reference path, not a separate capability.

## Related documentation

- [Current shape](2026-08-30-game-reference-links.shape.md) — cadence, scope, risks, and success signal for this grow session.
- [Binding architecture](../ARCHITECTURE.md) — structural and trust-boundary authority.
- [Binding testing posture](../TESTING.md) — verification-domain authority.
- [Direction index](index.md) — current and historical WSD direction artifacts.
