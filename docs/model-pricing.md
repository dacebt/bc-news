---
type: doc
title: >-
  bc-news model admission and pricing register
description: >-
  Descriptive register of admitted hosted model profiles, current example candidates, checked-in deployment selection, local evaluation-evidence status, and provider-owned pricing sources.
tags: [documentation, models, evaluation, pricing]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:58:59Z"
authority: descriptive
---

# bc-news model admission and pricing register

This register separates four states that are easy to conflate:

- **Admitted** means the current adapter registry has an explicit request
  profile for the model. It is a transport-contract claim, not evaluation
  evidence or production selection.
- **Current example** means the model appears in the checked-in Cloudflare AI
  Gateway benchmark example. It is still an operator-reviewed example, not a
  recommendation or deployment declaration.
- **Historical** means a model name survives only in a retired register or a
  Git-addressed historical artifact. Historical names are not current evidence.
- **Checked-in deployment** is the adapter selection in the generation Worker
  configuration. It currently selects the committed `recorded` adapter for all
  two production steps, so no live model below is selected there.

The binding evaluation boundaries live in [test and verification posture](TESTING.md),
and commands live in [evaluation operations](evaluation-operations.md).

## Admitted hosted models

The current source of truth is
`packages/model-adapters/src/cloudflare-hosted-model-profiles.ts`. The current
example source is `apps/eval/cloudflare-ai-gateway.benchmark.example.json`.
Pricing was checked against Cloudflare's public primary documentation on
2026-08-18. Prices are mutable and must be rechecked before spend.

| Model | Billing route | Current example | Public price evidence |
|---|---|---:|---|
| `openai/gpt-5-nano` | Unified Billing | Yes | [Cloudflare model record](https://developers.cloudflare.com/ai/models/openai/gpt-5-nano/) routes current pricing to the Cloudflare dashboard |
| `openai/gpt-5-mini` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/openai/gpt-5-mini/) routes current pricing to the Cloudflare dashboard |
| `openai/gpt-5.6-luna` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/openai/gpt-5.6-luna/) routes current Gateway pricing to the Cloudflare dashboard; [OpenAI direct reference](https://developers.openai.com/api/docs/models/gpt-5.6-luna) lists current direct rates separately from Cloudflare-routed billing |
| `openai/gpt-4o` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/openai/gpt-4o/) routes current pricing to the Cloudflare dashboard |
| `openai/gpt-4o-mini` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/openai/gpt-4o-mini/) routes current pricing to the Cloudflare dashboard |
| `alibaba/qwen3.5-397b-a17b` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/alibaba/qwen3.5-397b-a17b/) routes current pricing to the Cloudflare dashboard |
| `google/gemini-2.5-flash-lite` | Unified Billing | Yes | [Cloudflare model record](https://developers.cloudflare.com/ai/models/google/gemini-2.5-flash-lite/) routes current pricing to the Cloudflare dashboard |
| `google/gemini-3.1-flash-lite` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/google/gemini-3.1-flash-lite/) routes current pricing to the Cloudflare dashboard |
| `google/gemini-3.7-flash` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/google/gemini-3.7-flash/) routes current pricing to the Cloudflare dashboard |
| `minimax/m3` | Unified Billing | No | [Cloudflare model record](https://developers.cloudflare.com/ai/models/minimax/m3/) routes current pricing to the Cloudflare dashboard |
| `@cf/openai/gpt-oss-120b` | Workers AI | No | [$0.35/M input, $0.75/M output](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| `@cf/google/gemma-4-26b-a4b-it` | Workers AI | No | [$0.10/M input, $0.30/M output](https://developers.cloudflare.com/workers-ai/platform/pricing/) |

[Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)
passes third-party provider inference rates through without markup and applies a
5% fee when credits are purchased. Workers AI models use Workers AI billing
instead. The public third-party Cloudflare model records do not expose numeric
rates, so this repository does not duplicate dashboard-only values. OpenAI's
direct public rates for Luna are upstream reference only and must not be
treated as Cloudflare-routed spend.

## Local model evidence status

The retired root register named these LM Studio models:

| Model | Current tracked evidence |
|---|---|
| `qwen/qwen3.5-9b` | None; historical name only |
| `prism-ml/bonsai-27b` | Content-free production-grounded and crossover aggregate summaries under `apps/eval/summaries/` |
| `google/gemma-4-e4b` | None; historical name only |
| `google/gemma-4-12b` | Content-free production-grounded and crossover aggregate summaries under `apps/eval/summaries/` |

They have no metered external API price, but hardware, electricity, and
operator time are still costs. A tracked aggregate proves only the exported
descriptive measurements and model subject name; detailed scorecards, source
evidence, and model outputs remain local-only. None of these names is selected
by the checked-in production configuration.
