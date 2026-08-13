# Model pricing

This is the price register for models present in retained evaluation artifacts.
Prices are in US dollars per one million tokens and were verified on
2026-08-13.

Third-party model rates were transcribed from the Cloudflare dashboard. Under
[Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/),
Cloudflare passes through the displayed inference rates without markup and
applies a 5% fee when credits are purchased. A $10 credit purchase therefore
costs $10.50 and provides $10 of inference credit.

## Cloudflare-hosted and third-party models

| Model | Billing route | Input | Output | Cached input | Cloudflare model record |
|---|---|---:|---:|---:|---|
| `openai/gpt-5-nano` | Unified Billing | $0.050 | $0.400 | $0.005 | [GPT-5 nano](https://developers.cloudflare.com/ai/models/openai/gpt-5-nano/) |
| `openai/gpt-4o` | Unified Billing | $2.50 | $10.00 | $1.25 | [GPT-4o](https://developers.cloudflare.com/ai/models/openai/gpt-4o/) |
| `openai/gpt-4o-mini` | Unified Billing | $0.150 | $0.600 | $0.075 | [GPT-4o mini](https://developers.cloudflare.com/ai/models/openai/gpt-4o-mini/) |
| `alibaba/qwen3.5-397b-a17b` | Unified Billing | $0.60 | $3.60 | Not listed | [Qwen 3.5 397B A17B](https://developers.cloudflare.com/ai/models/alibaba/qwen3.5-397b-a17b/) |
| `google/gemini-3.1-flash-lite` | Unified Billing | $0.25 | $1.50 | $0.03 | [Gemini 3.1 Flash Lite](https://developers.cloudflare.com/ai/models/google/gemini-3.1-flash-lite/) |
| `@cf/openai/gpt-oss-120b` | Workers AI | $0.35 | $0.75 | Not listed | [gpt-oss-120b](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/) |

The Gemini dashboard displays the same input, output, and cached-input rates for
requests at or below 200,000 tokens and requests above 200,000 tokens.

For a run with reported token usage:

```text
inference cost = (uncached input tokens / 1,000,000 * input rate)
               + (cached input tokens / 1,000,000 * cached-input rate)
               + (output tokens / 1,000,000 * output rate)
```

Treat cached input as zero when the provider does not report it separately.
The 5% Unified Billing credit-purchase fee is not part of the inference-cost
formula.

## Local models

These models ran through local LM Studio and have no metered external API
charge. Hardware, electricity, and operator time are not represented as zero.

| Model | Execution | Metered API price |
|---|---|---:|
| `qwen/qwen3.5-9b` | Local LM Studio | None |
| `prism-ml/bonsai-27b` | Local LM Studio | None |
| `google/gemma-4-e4b` | Local LM Studio | None |
| `google/gemma-4-12b` | Local LM Studio | None |
