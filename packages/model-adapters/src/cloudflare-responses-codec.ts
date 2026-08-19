import { z } from "zod";
import {
	observedString,
	type ModelRuntimeEvidence,
	type ModelRuntimeIdentity,
} from "@bc-news/generation-core";
import {
	CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES,
	cloudflareHostedModelOutputSchema,
	cloudflareHostedModelResponseText,
	type CloudflareHostedModelId,
} from "./cloudflare-hosted-model-profiles";
import type { ProductionStepOutputContract } from "./production-step-output-contracts";

const NonBlankExactStringSchema = z.string().min(1).refine((value) => value.trim().length > 0);

const UsageSchema = z.looseObject({
	input_tokens: z.int().nonnegative(),
	output_tokens: z.int().nonnegative(),
	total_tokens: z.int().nonnegative(),
}).refine((usage) => usage.total_tokens === usage.input_tokens + usage.output_tokens);

const ResponseContentSchema = z.looseObject({
	type: z.string().min(1),
	text: NonBlankExactStringSchema.optional(),
});

const ResponseMessageSchema = z.looseObject({
	type: z.literal("message"),
	status: NonBlankExactStringSchema,
	role: NonBlankExactStringSchema,
	content: z.array(ResponseContentSchema),
}).superRefine((message, context) => {
	if (Object.prototype.hasOwnProperty.call(message, "tool_calls")) {
		context.addIssue({
			code: "custom",
			path: ["tool_calls"],
			message: "response output message must not include tool calls",
		});
	}
	if (Object.prototype.hasOwnProperty.call(message, "function_call")) {
		context.addIssue({
			code: "custom",
			path: ["function_call"],
			message: "response output message must not include function call metadata",
		});
	}
});

type ResponseOutputItem = {
	readonly type: string;
	readonly [key: string]: unknown;
};

type ResponseMessage = z.infer<typeof ResponseMessageSchema>;

function addResponseContractIssue(
	context: z.RefinementCtx | undefined,
	path: ReadonlyArray<string | number>,
	message: string,
): false {
	if (context === undefined) {
		throw new Error(message);
	}
	context.addIssue({
		code: "custom",
		path: [...path],
		message,
	});
	return false;
}

function validateResponseMessage(
	message: ResponseMessage,
	messageIndex: number,
	context?: z.RefinementCtx,
): boolean {
	let valid = true;
	if (message.status !== "completed") {
		valid = false;
		addResponseContractIssue(
			context,
			["output", messageIndex, "status"],
			"response output message must be completed",
		);
	}
	if (message.role !== "assistant") {
		valid = false;
		addResponseContractIssue(
			context,
			["output", messageIndex, "role"],
			"response output message must use the assistant role",
		);
	}
	if (message.content.length === 0) {
		return addResponseContractIssue(
			context,
			["output", messageIndex, "content"],
			"response output message must contain one or more content items",
		);
	}
	for (const [contentIndex, content] of message.content.entries()) {
		if (content.type !== "output_text") {
			valid = false;
			addResponseContractIssue(
				context,
				["output", messageIndex, "content", contentIndex, "type"],
				"response output content must be a completed output_text item",
			);
		}
		if (typeof content.text !== "string" || content.text.trim().length === 0) {
			valid = false;
			addResponseContractIssue(
				context,
				["output", messageIndex, "content", contentIndex, "text"],
				"response output text must be nonblank",
			);
		}
	}
	return valid;
}

function responseMessageFromOutput(
	output: ReadonlyArray<ResponseOutputItem>,
	context?: z.RefinementCtx,
): ResponseMessage | null {
	let messageCount = 0;
	let selectedMessage: ResponseMessage | null = null;
	for (const [outputIndex, item] of output.entries()) {
		if (item.type === "reasoning") {
			continue;
		}
		if (item.type !== "message") {
			addResponseContractIssue(
				context,
				["output", outputIndex, "type"],
				"response output items must be reasoning or message",
			);
			continue;
		}
		messageCount += 1;
		const messageResult = ResponseMessageSchema.safeParse(item);
		if (!messageResult.success) {
			if (context === undefined) {
				throw messageResult.error;
			}
			for (const issue of messageResult.error.issues) {
				context.addIssue({
					code: "custom",
					path: ["output", outputIndex, ...issue.path],
					message: issue.message,
				});
			}
			continue;
		}
		const message = messageResult.data;
		if (validateResponseMessage(message, outputIndex, context) && selectedMessage === null) {
			selectedMessage = message;
		}
	}
	if (messageCount !== 1) {
		addResponseContractIssue(
			context,
			["output"],
			"response output must contain exactly one message item",
		);
		return null;
	}
	return selectedMessage;
}

function responseMessageText(message: ResponseMessage): string {
	let text = "";
	for (const content of message.content) {
		if (content.type !== "output_text") {
			throw new Error("response output content must be a completed output_text item");
		}
		if (typeof content.text !== "string" || content.text.trim().length === 0) {
			throw new Error("response output text must be nonblank");
		}
		text += content.text;
	}
	return text;
}

export const CloudflareResponsesSchema = z.looseObject({
	id: NonBlankExactStringSchema,
	object: z.literal("response"),
	model: NonBlankExactStringSchema,
	status: z.enum(["completed", "failed", "in_progress", "incomplete", "cancelled", "queued"]),
	output: z.array(z.looseObject({ type: z.string().min(1) })),
	usage: UsageSchema,
}).superRefine((response, context) => {
	if (response.status !== "completed") {
		context.addIssue({
			code: "custom",
			path: ["status"],
			message: "response status must be completed",
		});
	}
	responseMessageFromOutput(response.output, context);
});

export type CloudflareResponses = z.infer<typeof CloudflareResponsesSchema>;

const unknownString = { state: "unknown" as const, reason: "not_reported" as const };
const unknownInteger = { state: "unknown" as const, reason: "not_reported" as const };
const unknownMeasurement = { state: "unknown" as const, reason: "not_reported" as const };
const providerControlledString = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledInteger = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledMeasurement = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledBoolean = { state: "externally_controlled" as const, reason: "provider_controlled" as const };

function gatewayModelIdentity(requestedModel: string, responseModel?: string): ModelRuntimeIdentity {
	return {
		requested_identity: observedString(requestedModel),
		identifier: responseModel === undefined ? providerControlledString : observedString(responseModel),
		model_key: providerControlledString,
		path: providerControlledString,
		display_name: providerControlledString,
		format: providerControlledString,
		instance_reference: providerControlledString,
		size_bytes: providerControlledInteger,
		architecture: providerControlledString,
		parameter_count_description: providerControlledString,
		quantization_name: providerControlledString,
		quantization_bits: providerControlledMeasurement,
		vision_capable: providerControlledBoolean,
		trained_for_tool_use: providerControlledBoolean,
	};
}

export function cloudflareHostedResponsesRequestBody(input: {
	readonly model: CloudflareHostedModelId;
	readonly system: string;
	readonly user: string;
	readonly temperature?: number;
	readonly outputContract: ProductionStepOutputContract;
}): Readonly<Record<string, unknown>> {
	const profile = CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[input.model];
	if (profile.requestFormat !== "responses") {
		throw new Error("Responses request body builder requires a Responses-profiled model");
	}
	return {
		model: input.model,
		...(input.temperature === undefined ? {} : { temperature: input.temperature }),
		input: [
			{ role: "system", content: input.system },
			{ role: "user", content: input.user },
		],
		text: {
			format: {
				type: "json_schema",
				name: input.outputContract.name,
				strict: true,
				schema: cloudflareHostedModelOutputSchema(input),
			},
		},
	};
}

export function cloudflareHostedResponsesText(input: {
	readonly model: CloudflareHostedModelId;
	readonly response: CloudflareResponses;
	readonly outputContract: ProductionStepOutputContract;
}): string | null {
	const message = responseMessageFromOutput(input.response.output);
	return cloudflareHostedModelResponseText({
		model: input.model,
		text: message === null ? null : responseMessageText(message),
		outputContract: input.outputContract,
	});
}

export function cloudflareResponsesRuntimeEvidence(
	requestedModel: string,
	response: CloudflareResponses,
): ModelRuntimeEvidence {
	return {
		execution_context: {
			client_sdk_release: { state: "unknown", reason: "not_applicable" },
			provider_runtime_identity: unknownString,
			provider_runtime_version: providerControlledString,
			provider_runtime_build: providerControlledInteger,
			provider_service_tier: unknownString,
			selected_model: gatewayModelIdentity(requestedModel),
			response_model: gatewayModelIdentity(requestedModel, response.model),
			context_length: { state: "externally_controlled", reason: "provider_controlled" },
			requested_reasoning_posture: { state: "observed", value: "provider_default" },
			effective_reasoning_setting: providerControlledString,
			speculative_draft_model_identity: unknownString,
		},
		prediction_observation: {
			provider_response_id: observedString(response.id),
			stop_reason: observedString(response.status),
			time_to_first_token_ms: unknownMeasurement,
			total_time_ms: unknownMeasurement,
			tokens_per_second: unknownMeasurement,
			speculative_total_tokens: unknownInteger,
			speculative_accepted_tokens: unknownInteger,
			speculative_rejected_tokens: unknownInteger,
			speculative_ignored_tokens: unknownInteger,
			reasoning_content_present: { state: "unknown", reason: "not_reported" },
		},
	};
}
