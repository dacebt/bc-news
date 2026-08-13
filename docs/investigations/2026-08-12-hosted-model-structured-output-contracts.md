---
type: investigation
title: >-
  Investigation: Hosted model structured-output contracts
description: >-
  Evidence-backed inventory of the Cloudflare request schemas, structured-output controls, and output-token controls for the five hosted models evaluated by bc-news.
tags: [investigation, models, cloudflare, structured-output]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-13T01:38:32Z"
---
# Investigation Report

**Question:** Which Cloudflare request schema, structured-output control, and output-token control applies to each hosted model already evaluated by bc-news?

**Date:** 2026-08-12

**Scope:**
- **In scope:** The current Cloudflare AI Gateway adapter; the shared production-step output contracts; Cloudflare's current REST, model-catalog, and Workers AI JSON Mode documentation for `openai/gpt-5-nano`, `openai/gpt-4o-mini`, `alibaba/qwen3.5-397b-a17b`, `google/gemini-3.1-flash-lite`, and `@cf/openai/gpt-oss-120b`.
- **Out of scope (deliberately):** Provider models not present in the retained hosted runs, changes to runtime prompts, deployment, Cloudflare configuration, credential inspection, and paid inference.
- **Observation:** No model endpoint was invoked because doing so would perform paid inference. Current behavior was established from the live request-construction path and retained artifacts; provider capabilities were checked against public primary documentation fetched on 2026-08-12.

---

## Summary

At evaluated source commit `10ea9dc`, the adapter sent every hosted model through Cloudflare's OpenAI-compatible `/ai/v1/chat/completions` endpoint, but sent neither a machine-readable output schema nor an explicit output-token allowance. All five retained hosted models expose a Chat Completions request variant through Cloudflare; those variants admit `response_format` and either `max_tokens`, `max_completion_tokens`, or both. GPT-OSS also has a Workers AI native request schema whose `max_tokens` default is 256, which explains the observed truncation when that adapter version omitted the field.

The implemented adapter deliberately leaves those output-token fields unset, so each provider applies its own default ceiling. The model-specific profiles retain only the request format, structured-output encoding, and provider identity.

---

## Hosted Model Request Contracts

At `10ea9dc`, the adapter was hard-wired to `https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions` and constructed a body containing only `model`, optional `temperature`, and `messages` (`10ea9dc:packages/model-adapters/src/cloudflare-ai-gateway-model-provider.ts:156-164,230-240`). Cloudflare documents `/ai/v1/chat/completions` as the OpenAI-compatible LLM endpoint for third-party and Workers AI models, while `/ai/v1/responses` is a distinct Responses API surface and `/ai/run` accepts each model's native schema ([Cloudflare REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)).

The production-step decode schemas had one canonical source: the Zod schemas converted to inline strict JSON Schema for LM Studio (`10ea9dc:packages/model-adapters/src/lmstudio-structured-output.ts:51-80`). The same outputs were subsequently parsed by strict Zod boundaries regardless of provider (`packages/generation-core/src/ports.ts:65-70`; `apps/eval/src/evaluation-artifact-v1-parser.ts:26-35`).

| Requested model | Cloudflare request variants | Chat structured-output field | Documented output-token fields |
| --- | --- | --- | --- |
| `openai/gpt-5-nano` | Responses, Chat Completions | `response_format` | `max_tokens`, `max_completion_tokens`; Responses uses `max_output_tokens` |
| `openai/gpt-4o-mini` | Responses, Chat Completions | `response_format` | `max_tokens`, `max_completion_tokens`; Responses uses `max_output_tokens` |
| `alibaba/qwen3.5-397b-a17b` | Chat Completions, Responses | `response_format` | `max_tokens`, `max_completion_tokens`; Responses uses `max_output_tokens` |
| `google/gemini-3.1-flash-lite` | Generate Content, Chat Completions | `response_format` in Chat Completions | `max_tokens`, `max_completion_tokens`; native Generate Content uses `generationConfig.maxOutputTokens` |
| `@cf/openai/gpt-oss-120b` | Workers AI native text generation, Chat Completions, Responses | `response_format` | Native and Chat Completions use `max_tokens`; native default is 256; Responses uses `max_output_tokens` |

Cloudflare's generated Worker types make the Chat Completions schema concrete: `response_format.type` may be `json_schema`, with `json_schema.name`, `json_schema.schema`, and optional `strict`; the request also admits both `max_tokens` and `max_completion_tokens` (`apps/generation/worker-configuration.d.ts:4980-4995`, `apps/generation/worker-configuration.d.ts:5032-5067`). The generated GPT-OSS type is explicitly an XOR of Responses and Chat Completions inputs (`apps/generation/worker-configuration.d.ts:9062-9065`).

Cloudflare separately documents Workers AI JSON Mode as schema-directed rather than an absolute guarantee: the service can return `JSON Mode couldn't be met` when a model cannot satisfy the requested schema ([Workers AI JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)). Runtime Zod parsing therefore remains required after provider-side structured output.

### Absences

At `10ea9dc`, hosted configuration accepted any syntactically valid `author/model` or `@cf/author/model` identifier (`10ea9dc:packages/model-adapters/src/config.ts:5-11,44-57`), so it did not establish whether that exact model had a researched request profile. The provider boundary also had no production-step output-contract input, even though the LM Studio adapter received those contracts explicitly (`10ea9dc:packages/model-adapters/src/lmstudio-model-provider.ts:54-70`). Consequently, a newly configured hosted model could silently inherit a generic request body without an established structured-output or output-budget contract.

---
_Indexed from [project investigations](./index.md) and the [documentation bundle](../index.md)._
