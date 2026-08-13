import { z } from "zod";
import type { ProductionStepOutputContract } from "./production-step-output-contracts";

export const CLOUDFLARE_HOSTED_MODEL_IDS = [
	"openai/gpt-5-nano",
	"openai/gpt-4o-mini",
	"alibaba/qwen3.5-397b-a17b",
	"google/gemini-3.1-flash-lite",
	"@cf/openai/gpt-oss-120b",
] as const;

export type CloudflareHostedModelId = typeof CLOUDFLARE_HOSTED_MODEL_IDS[number];

export const CloudflareHostedModelIdSchema = z.enum(CLOUDFLARE_HOSTED_MODEL_IDS);

interface CloudflareHostedModelRequestProfile {
	readonly provider: "openai" | "alibaba" | "google" | "workers_ai";
	readonly requestFormat: "chat_completions";
	readonly structuredOutputFormat: "openai_chat_json_schema";
	readonly outputTokenField: "max_tokens" | "max_completion_tokens";
	readonly outputTokenLimit: number;
}

export const CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES: Readonly<
	Record<CloudflareHostedModelId, CloudflareHostedModelRequestProfile>
> = {
	"openai/gpt-5-nano": {
		provider: "openai",
		requestFormat: "chat_completions",
		structuredOutputFormat: "openai_chat_json_schema",
		outputTokenField: "max_completion_tokens",
		outputTokenLimit: 16_384,
	},
	"openai/gpt-4o-mini": {
		provider: "openai",
		requestFormat: "chat_completions",
		structuredOutputFormat: "openai_chat_json_schema",
		outputTokenField: "max_completion_tokens",
		outputTokenLimit: 16_384,
	},
	"alibaba/qwen3.5-397b-a17b": {
		provider: "alibaba",
		requestFormat: "chat_completions",
		structuredOutputFormat: "openai_chat_json_schema",
		outputTokenField: "max_tokens",
		outputTokenLimit: 16_384,
	},
	"google/gemini-3.1-flash-lite": {
		provider: "google",
		requestFormat: "chat_completions",
		structuredOutputFormat: "openai_chat_json_schema",
		outputTokenField: "max_tokens",
		outputTokenLimit: 16_384,
	},
	"@cf/openai/gpt-oss-120b": {
		provider: "workers_ai",
		requestFormat: "chat_completions",
		structuredOutputFormat: "openai_chat_json_schema",
		outputTokenField: "max_tokens",
		outputTokenLimit: 16_384,
	},
};

export function cloudflareHostedModelRequestBody(input: {
	readonly model: CloudflareHostedModelId;
	readonly system: string;
	readonly user: string;
	readonly temperature?: number;
	readonly outputContract: ProductionStepOutputContract;
}): Readonly<Record<string, unknown>> {
	const profile = CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[input.model];
	return {
		model: input.model,
		...(input.temperature === undefined ? {} : { temperature: input.temperature }),
		[profile.outputTokenField]: profile.outputTokenLimit,
		messages: [
			{ role: "system", content: input.system },
			{ role: "user", content: input.user },
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: input.outputContract.name,
				strict: true,
				schema: input.outputContract.schema,
			},
		},
	};
}
