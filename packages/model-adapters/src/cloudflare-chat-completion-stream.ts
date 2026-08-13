import { z } from "zod";
import {
	CloudflareAiGatewayDeterministicError,
	CloudflareAiGatewayRetryableError,
} from "./cloudflare-ai-gateway-errors";

const StreamChunkSchema = z.looseObject({
	id: z.string().trim().min(1).optional(),
	model: z.string().trim().min(1).optional(),
	service_tier: z.string().nullable().optional(),
	system_fingerprint: z.string().nullable().optional(),
	choices: z.array(z.looseObject({
		index: z.int().nonnegative(),
		delta: z.looseObject({ content: z.string().nullable().optional() }),
		finish_reason: z.string().nullable().optional(),
	})),
	usage: z.unknown().nullable().optional(),
});

function invalidStream(message: string): CloudflareAiGatewayDeterministicError {
	return new CloudflareAiGatewayDeterministicError(
		"cloudflare_ai_gateway_invalid_stream",
		message,
		{
			details: {
				contract: "cloudflare_ai_gateway_chat_completion_stream",
				issues: [{ path: [], code: "invalid_stream_event" }],
			},
		},
	);
}

function retainConsistentString(current: string | undefined, candidate: string | undefined, field: string): string | undefined {
	if (candidate === undefined) return current;
	if (current !== undefined && current !== candidate) throw invalidStream(`Cloudflare AI Gateway stream changed ${field} between events`);
	return candidate;
}

function dataPayloads(body: string): readonly string[] {
	return body
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.split("\n\n")
		.map((event) => event
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /u, ""))
			.join("\n"))
		.filter((payload) => payload !== "");
}

export function assembleCloudflareChatCompletionStream(body: string): unknown {
	let id: string | undefined;
	let model: string | undefined;
	let serviceTier: string | null | undefined;
	let systemFingerprint: string | null | undefined;
	let finishReason: string | null | undefined;
	let usage: unknown;
	let content = "";
	let sawChunk = false;
	let sawDone = false;

	for (const payload of dataPayloads(body)) {
		if (payload === "[DONE]") {
			sawDone = true;
			continue;
		}
		if (sawDone) throw invalidStream("Cloudflare AI Gateway stream continued after its completion marker");
		let candidate: unknown;
		try {
			candidate = JSON.parse(payload);
		} catch (cause) {
			throw new CloudflareAiGatewayDeterministicError(
				"cloudflare_ai_gateway_invalid_stream",
				"Cloudflare AI Gateway stream contained invalid JSON",
				{ cause, details: { contract: "cloudflare_ai_gateway_chat_completion_stream", issues: [{ path: [], code: "invalid_json_event" }] } },
			);
		}
		const parsed = StreamChunkSchema.safeParse(candidate);
		if (!parsed.success) throw invalidStream("Cloudflare AI Gateway stream event rejected by the strict chunk contract");
		if (parsed.data.choices.some((choice) => choice.index !== 0)) {
			throw invalidStream("Cloudflare AI Gateway stream returned an unsupported completion choice index");
		}
		sawChunk = true;
		id = retainConsistentString(id, parsed.data.id, "response id");
		model = retainConsistentString(model, parsed.data.model, "response model");
		if (parsed.data.service_tier !== undefined) serviceTier = parsed.data.service_tier;
		if (parsed.data.system_fingerprint !== undefined) systemFingerprint = parsed.data.system_fingerprint;
		if (parsed.data.usage !== undefined && parsed.data.usage !== null) usage = parsed.data.usage;
		for (const choice of parsed.data.choices) {
			if (typeof choice.delta.content === "string") content += choice.delta.content;
			if (choice.finish_reason !== undefined) finishReason = choice.finish_reason;
		}
	}

	if (!sawChunk) throw invalidStream("Cloudflare AI Gateway stream contained no completion events");
	if (!sawDone) {
		throw new CloudflareAiGatewayRetryableError(
			"cloudflare_ai_gateway_network_failure",
			"Cloudflare AI Gateway stream ended before its completion marker",
		);
	}
	return {
		...(id === undefined ? {} : { id }),
		...(model === undefined ? {} : { model }),
		choices: [{ message: { content: content === "" ? null : content }, finish_reason: finishReason }],
		...(usage === undefined ? {} : { usage }),
		...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
		...(systemFingerprint === undefined ? {} : { system_fingerprint: systemFingerprint }),
	};
}
