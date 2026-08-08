---
type: shape
title: >-
  Shape: native LM Studio inference adapter
description: >-
  Session boundaries, cadence, and success signal for replacing local OpenAI-compatible inference with the native LM Studio SDK.
tags: [wsd, direction, shape, lm-studio, model-adapters]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-07T19:31:52Z"
---
# Shape: native LM Studio inference adapter

**Declared:** 2026-08-07
**Cadence:** Loose
**Git strategy:** commit-to-main — one accepted thickening at a time

## In scope

- Replace handwritten OpenAI-compatible local inference with an `@lmstudio/sdk`
  adapter behind `ModelProviderPort` in generation and real evaluation.
- Preserve four-step configuration, structured output, identity, usage, zero
  billing, cancellation, failure classification, parsing, and preservation.
- Prove Node evaluation and local Worker execution on representative evidence;
  align context-benchmark connection rules and remove superseded LM Studio code.
- Enable Cloudflare's documented `nodejs_compat` Worker flag required by the
  SDK's published ESM bundle, subject to real bundle and runtime proof.

## Out of scope (deliberately)

- Hosted inference, Cloudflare AI Gateway, frontier credentials, or vendor adapters.
- Prompt, editorial, evidence, fixture, model-selection, or acceptance-policy
  changes; `openai/gpt-oss-20b` remains excluded.
- Production Cloudflare mutation, a generalized adapter framework, a third
  domain port, or unrelated cleanup.

## Known risks

- Browser and outbound-WebSocket support are documented, but the installed SDK
  imports Node compatibility surfaces. `nodejs_compat` is the only authorized
  compatibility mechanism; any further shim or fallback blocks completion.
- Public prediction options do not visibly expose current `reasoning_effort`;
  preservation needs observed native behavior or a supported mapping.
- Native structured output and statistics differ from the current envelope;
  the application boundary must remain rejecting and truthful.

## Success signal

With one approved local model already loaded, a fixed representative conversation completes all four production model steps through the native SDK in local Worker generation, a real evaluation trial retains native model and usage evidence, and the independent recorded-provider `pnpm walk -- --non-interactive` still ends in `WALK PASS`.

## Notes

This is BCN-001. It is one provider capability across two required consumers,
so no capability map or domain-model revision is introduced at shape time.

## Related documentation

- [Structural discipline](../ARCHITECTURE.md) — binds the existing model-provider port and rejecting boundaries.
- [Test and verification posture](../TESTING.md) — keeps live model evaluation distinct from the composed recorded-provider walk.
- [WSD domain model](bc-news.model.md) — supplies the established evaluation vocabulary.
