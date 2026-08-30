---
type: shape
title: >-
  Shape: game-reference links in newspaper editions
description: >-
  Loose-cadence session boundary for resolving BitCraft chat references into safe, retained newspaper links.
tags: [wsd, direction, shape, generation, client, bitjita, game-references]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-30T14:37:52Z"
---
# Shape: game-reference links in newspaper editions

**Declared:** 2026-08-30
**Cadence:** Loose
**Git strategy:** commit-to-main

## In scope

- Carry every reference form observed in the retained public-message corpus through evidence preparation, editorial generation, edition assembly, and newspaper rendering.
- Resolve observed entity identities during edition creation through application-identified, schema-validated BitJita requests and retain the resolved display and destination with the edition.
- Render bare and author-labeled coordinates as code-owned links to a focused BitCraft Map while preserving the original northing and easting.
- Keep arbitrary chat-authored and model-authored URLs inert, with explicit non-guessing behavior for malformed, unknown, and unavailable references.
- Add corpus-grounded and synthetic adversarial fixtures, update the runtime prompts, run representative local-model evidence after a human checkpoint, and prove the composed behavior through the repository-owned walk.
- Reconcile the bc-news BitJita integration documentation with the endpoints, identification header, validation boundary, and reader destinations the implementation actually uses.

## Out of scope (deliberately)

- Production access, publication, deployment, push, hosted inference, or changes to the deployed model selection.
- Place-name inference for bare coordinates, a general-purpose rich-text system, or enabling arbitrary Markdown links in newspaper prose.
- Reference kinds absent from the retained corpus (`build`, `col`, and `mob`) unless direct build evidence shows they are required by the same invariant.
- Broader BitJita catalog synchronization, search, market data, or unrelated client and editorial redesign.

## Known risks

- Reference tokens cross an untrusted-chat and model-output boundary; the implementation must not transfer URL authority to either source.
- BitJita rate limiting, response-envelope drift, or transient failure could otherwise produce partial or misleading editions.
- A current edition-contract change must preserve truthful parsing and inert rendering of historical editions.
- Local writers may omit, alter, or invent reference tokens even when deterministic contracts are correct.

## Success signal

The composed local walk publishes and browser-renders an edition whose corpus-grounded coordinate and entity references display truthfully, open only the exact focused-map or validated BitJita destinations retained with the edition, and leave arbitrary URLs inert; representative local-model evidence shows both writers preserve the code-owned reference contract.

## Notes

The user must be notified before the new fixture invokes local models. That checkpoint does not authorize hosted inference, deployment, publication, or push.

## Related documentation

- [Capability map](2026-08-30-game-reference-links.map.md) — actor-visible carve and conventions for this feature.
- [Binding architecture](../ARCHITECTURE.md) — owns the core, boundary, and port discipline this feature must preserve.
- [Binding testing posture](../TESTING.md) — owns the separation between deterministic verification, local-model evidence, and the composed walk.
- [Direction index](index.md) — current and historical WSD direction artifacts.
