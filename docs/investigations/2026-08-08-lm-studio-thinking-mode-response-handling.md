---
type: investigation
title: >-
  Investigation: LM Studio thinking-mode response handling
description: >-
  Direct SDK and HTTP evidence tracing why thinking-enabled LM Studio calls produced zero parsed outputs.
tags: [investigation, lm-studio, models, reasoning, structured-output]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-08T06:35:23Z"
---
# Investigation Report

**Question:** How does bc-news parse LM Studio responses in thinking mode, and is
the zero parsed-output result caused by our response handling?

**Date:** 2026-08-08

**Scope:**
- **In scope:** The native LM Studio adapter, the generation-core JSON parsers,
  the adapter it replaced, the installed `@lmstudio/sdk` 1.5.0 implementation,
  the retained thinking-on and thinking-off benchmarks, and bounded calls to the
  loaded `qwen/qwen3.5-9b` model.
- **Out of scope (deliberately):** Cloudflare AI Gateway, model-quality scoring,
  prompt redesign, and changes to the LM Studio model profile. None determine
  which response channel the adapter passes to the application parser.
- **Observation:** The loaded model was invoked through both the native SDK and
  LM Studio's OpenAI-compatible HTTP stream. Toy structured output was allowed
  to terminate; production-matched probes used the retained request, strict
  schema, and `temperature: 0`, `top_p: 1`, `top_k: 1`, then were cancelled
  after 30 seconds. These probes perform local inference but do not alter
  repository or persisted application state.

---

## Summary

bc-news has a confirmed response-selection defect: the native adapter passes
SDK `result.content` to strict JSON parsing, but SDK 1.5.0 defines that field as
the concatenation of reasoning, structural separators, and answer content.
Thinking-mode JSON is isolated in `result.nonReasoningContent`. A terminal live
probe made `JSON.parse(result.content)` fail and
`JSON.parse(result.nonReasoningContent)` succeed with the same result.

That defect did not itself produce the retained zero-parse benchmark. Those
calls timed out before the model emitted any non-reasoning content, so no
application parser ran. The historical working path had explicitly disabled
reasoning; there is no verified thinking-enabled production baseline in the
repository evidence examined here.

---

## Why Thinking-Mode Responses Do Not Reach Valid JSON

The production path has three distinct stages. The LM Studio adapter awaits a
terminal SDK result and assigns `result.content` to `ModelCompletion.text`
(`packages/model-adapters/src/lmstudio-model-provider.ts:130-162`). The eval and
generation callers pass that text unchanged to the production-step parser
(`apps/eval/src/production-step-runners.ts:49-74`,
`apps/eval/src/production-step-runners.ts:77-119`). Each parser starts with a
plain `JSON.parse(text)` and rejects any preamble
(`packages/generation-core/src/main-story.ts:114-137`,
`packages/generation-core/src/announcements.ts:57-77`).

The installed SDK's result contract makes `content` the complete generated
stream while exposing reasoning and answer-only text separately as
`reasoningContent` and `nonReasoningContent`
(`node_modules/.pnpm/@lmstudio+sdk@1.5.0/node_modules/@lmstudio/sdk/dist/index.d.ts:581-595`).
Its collector constructs `content` by joining every fragment, then constructs
`reasoningContent` from non-structural `reasoning` fragments and
`nonReasoningContent` from non-structural `none` fragments
(`node_modules/.pnpm/@lmstudio+sdk@1.5.0/node_modules/@lmstudio/sdk/dist/index.mjs:16818-16853`).

A native structured-output probe against the loaded Qwen model terminated with
`eosFound` after 219 reasoning fragments and five non-reasoning fragments. Its
`content` began with `Thinking Process:`, included LM Studio's synthetic
reasoning separator, and ended with `{"answer":"OK"}`. Its
`nonReasoningContent` was exactly `{"answer":"OK"}`. Direct parsing failed for
the former with `Unexpected token 'T'` and succeeded for the latter. This is a
direct reproduction of the adapter's response-selection defect.

The retained thinking-enabled benchmark shows a different stopping point. Its
four transport attempts ended as `lmstudio_timeout`, retained null completions,
and left parsing pending
(`apps/eval/evaluation-results/benchmark-2026-08-08T01-26-39-000Z-bf8be719-4702-403d-8d60-723bf4677da9.json`).
A 30-second native reproduction using that artifact's first request and current
main-story schema emitted 2,006 reasoning fragments and zero non-reasoning
fragments before cancellation; the terminal stop reason was `userStopped`.
The same request through LM Studio's HTTP stream emitted 2,011 chunks, 7,837
reasoning characters, and zero content characters before the same bound. This
confirms that the long reasoning phase is not unique to the SDK transport and
that no valid answer channel existed for the application to parse at the point
represented by the zero-parse artifact.

The earlier HTTP adapter had the correct response-channel selection for a
thinking-capable envelope: it accepted `reasoning` or `reasoning_content` but
returned only `choices[0].message.content` as application text
(`af09997^:packages/model-adapters/src/openai-compatible-model-provider.ts:63-91`,
`af09997^:packages/model-adapters/src/openai-compatible-model-provider.ts:332-358`).
However, the repository's prior reliability fix explicitly added
`reasoning_effort: "none"` to the working local configuration (`2d8369e`). The
successful retained native run likewise occurred only after the external LM
Studio thinking toggle was disabled
(`apps/eval/evaluation-results/benchmark-2026-08-08T05-59-03-987Z-c19d8603-7d20-4948-b003-a9b4114ff60a.json`).
Repository and runtime evidence therefore establish a non-thinking baseline,
not a previously verified thinking-enabled baseline.

---
_Indexed from [project investigations](./index.md) and the [documentation bundle](../index.md)._
