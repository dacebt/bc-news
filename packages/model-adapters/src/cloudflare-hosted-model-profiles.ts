import { z } from "zod";
import type { ProductionStepOutputContract } from "./production-step-output-contracts";

export const CLOUDFLARE_HOSTED_MODEL_IDS = [
	"openai/gpt-5-nano",
	"openai/gpt-5-mini",
	"openai/gpt-5.6-luna",
	"openai/gpt-4o",
	"openai/gpt-4o-mini",
	"alibaba/qwen3.5-397b-a17b",
	"google/gemini-2.5-flash-lite",
	"google/gemini-3.1-flash-lite",
	"google/gemini-3.7-flash",
	"minimax/m3",
	"@cf/openai/gpt-oss-120b",
	"@cf/google/gemma-4-26b-a4b-it",
] as const;

export type CloudflareHostedModelId = typeof CLOUDFLARE_HOSTED_MODEL_IDS[number];

export const CloudflareHostedModelIdSchema = z.enum(CLOUDFLARE_HOSTED_MODEL_IDS);

interface CloudflareHostedModelRequestProfile {
	readonly provider: "openai" | "alibaba" | "google" | "minimax" | "workers_ai";
	readonly requestFormat: "chat_completions" | "responses";
	readonly responseDelivery: "buffered" | "streaming";
	readonly structuredOutputFormat: "openai_chat_json_schema" | "openai_responses_json_schema";
	readonly structuredOutputSchema: "canonical" | "openai_required_nullable";
}

export const CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES: Readonly<
	Record<CloudflareHostedModelId, CloudflareHostedModelRequestProfile>
> = {
	"openai/gpt-5-nano": {
		provider: "openai",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "openai_required_nullable",
	},
	"openai/gpt-5-mini": {
		provider: "openai",
		requestFormat: "chat_completions",
		responseDelivery: "streaming",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "openai_required_nullable",
	},
	"openai/gpt-5.6-luna": {
		provider: "openai",
		requestFormat: "responses",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_responses_json_schema",
		structuredOutputSchema: "openai_required_nullable",
	},
	"openai/gpt-4o": {
		provider: "openai",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "openai_required_nullable",
	},
	"openai/gpt-4o-mini": {
		provider: "openai",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "openai_required_nullable",
	},
	"alibaba/qwen3.5-397b-a17b": {
		provider: "alibaba",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "canonical",
	},
	"google/gemini-2.5-flash-lite": {
		provider: "google",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "canonical",
	},
	"google/gemini-3.1-flash-lite": {
		provider: "google",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "canonical",
	},
	"google/gemini-3.7-flash": {
		provider: "google",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "canonical",
	},
	"minimax/m3": {
		provider: "minimax",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "canonical",
	},
	"@cf/openai/gpt-oss-120b": {
		provider: "workers_ai",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "canonical",
	},
	"@cf/google/gemma-4-26b-a4b-it": {
		provider: "workers_ai",
		requestFormat: "chat_completions",
		responseDelivery: "buffered",
		structuredOutputFormat: "openai_chat_json_schema",
		structuredOutputSchema: "canonical",
	},
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableJsonSchema(schema: JsonObject): JsonObject {
	if (typeof schema.type === "string") return { ...schema, type: [schema.type, "null"] };
	if (Array.isArray(schema.type)) {
		const types = schema.type.filter((value: unknown): value is string => typeof value === "string");
		return types.includes("null") ? schema : { ...schema, type: [...types, "null"] };
	}
	return { anyOf: [schema, { type: "null" }] };
}

function openAiRequiredNullableSchema(candidate: unknown): unknown {
	if (Array.isArray(candidate)) return candidate.map(openAiRequiredNullableSchema);
	if (!isJsonObject(candidate)) return candidate;
	const transformed = Object.fromEntries(
		Object.entries(candidate).map(([key, value]) => [key, openAiRequiredNullableSchema(value)]),
	);
	if (candidate.type !== "object" || !isJsonObject(candidate.properties)) return transformed;
	const canonicalRequired = new Set(Array.isArray(candidate.required) ? candidate.required : []);
	const properties = Object.fromEntries(Object.entries(transformed.properties as JsonObject).map(
		([key, schema]) => [key, canonicalRequired.has(key) || !isJsonObject(schema) ? schema : nullableJsonSchema(schema)],
	));
	return { ...transformed, properties, required: Object.keys(properties) };
}

function omitCanonicalOptionalNulls(
	value: unknown,
	schema: unknown,
): { readonly value: unknown; readonly changed: boolean } {
	if (!isJsonObject(schema)) return { value, changed: false };
	if (Array.isArray(value) && isJsonObject(schema.items)) {
		let changed = false;
		const normalized = value.map((entry) => {
			const result = omitCanonicalOptionalNulls(entry, schema.items);
			changed ||= result.changed;
			return result.value;
		});
		return { value: normalized, changed };
	}
	if (!isJsonObject(value) || !isJsonObject(schema.properties)) return { value, changed: false };
	const canonicalRequired = new Set(Array.isArray(schema.required) ? schema.required : []);
	let changed = false;
	const normalized: JsonObject = {};
	for (const [key, entry] of Object.entries(value)) {
		const propertySchema = schema.properties[key];
		if (entry === null && !canonicalRequired.has(key) && propertySchema !== undefined) {
			changed = true;
			continue;
		}
		const result = omitCanonicalOptionalNulls(entry, propertySchema);
		changed ||= result.changed;
		normalized[key] = result.value;
	}
	return { value: normalized, changed };
}

function schemaForProfile(
	profile: CloudflareHostedModelRequestProfile,
	outputContract: ProductionStepOutputContract,
): unknown {
	return profile.structuredOutputSchema === "openai_required_nullable"
		? openAiRequiredNullableSchema(outputContract.schema)
		: outputContract.schema;
}

export function cloudflareHostedModelOutputSchema(input: {
	readonly model: CloudflareHostedModelId;
	readonly outputContract: ProductionStepOutputContract;
}): unknown {
	return schemaForProfile(
		CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[input.model],
		input.outputContract,
	);
}

export function cloudflareHostedModelRequestBody(input: {
	readonly model: CloudflareHostedModelId;
	readonly system: string;
	readonly user: string;
	readonly temperature?: number;
	readonly enableThinking?: false;
	readonly outputContract: ProductionStepOutputContract;
}): Readonly<Record<string, unknown>> {
	const profile = CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[input.model];
	return {
		model: input.model,
		...(input.temperature === undefined ? {} : { temperature: input.temperature }),
		...(input.enableThinking === false ? { thinking: { type: "disabled" } } : {}),
		...(profile.responseDelivery === "streaming"
			? { stream: true, stream_options: { include_usage: true } }
			: {}),
		messages: [
			{ role: "system", content: input.system },
			{ role: "user", content: input.user },
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: input.outputContract.name,
				strict: true,
				schema: cloudflareHostedModelOutputSchema(input),
			},
		},
	};
}

export function cloudflareHostedModelResponseText(input: {
	readonly model: CloudflareHostedModelId;
	readonly text: string | null;
	readonly outputContract: ProductionStepOutputContract;
}): string | null {
	if (
		input.text === null
		|| CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[input.model].structuredOutputSchema !== "openai_required_nullable"
	) return input.text;
	let candidate: unknown;
	try {
		candidate = JSON.parse(input.text);
	} catch {
		return input.text;
	}
	const normalized = omitCanonicalOptionalNulls(candidate, input.outputContract.schema);
	return normalized.changed ? JSON.stringify(normalized.value) : input.text;
}
