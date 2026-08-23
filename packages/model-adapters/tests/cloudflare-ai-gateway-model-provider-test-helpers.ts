import {
	CLOUDFLARE_HOSTED_MODEL_IDS,
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	createCloudflareAiGatewayModelProvider,
} from "../src/index";

export function provider(
	model: typeof CLOUDFLARE_HOSTED_MODEL_IDS[number] = "openai/gpt-4o-mini",
	gateway?: { selection: "named"; id: string },
) {
	return createCloudflareAiGatewayModelProvider({
		accountId: "account-id",
		apiToken: "cloudflare-api-token",
		...(gateway === undefined ? {} : { gateway }),
		requestedModel: model,
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}

export function request(productionStep: keyof typeof PRODUCTION_STEP_OUTPUT_CONTRACTS = "main_story_write") {
	return {
		productionStep,
		system: "system constraints",
		user: "writer prompt",
		correlation: { run_id: "benchmark-one", invocation_id: "invocation-one" },
	};
}

export function completionResponse(model = "gpt-4o-mini") {
	return new Response(JSON.stringify({
		id: "chatcmpl-one",
		object: "chat.completion",
		model,
		choices: [{
			index: 0,
			message: { role: "assistant", content: "completion", refusal: null, annotations: [] },
			finish_reason: "stop",
			logprobs: null,
		}],
		usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
		gatewayMetadata: { keySource: "Unified" },
	}), { headers: { "content-type": "application/json", "cf-aig-log-id": "gateway-log-one" } });
}

export function completionResponseWithContent(content: string, model = "gpt-4o") {
	return new Response(JSON.stringify({
		id: "chatcmpl-one",
		object: "chat.completion",
		model,
		choices: [{
			index: 0,
			message: { role: "assistant", content, refusal: null, annotations: [] },
			finish_reason: "stop",
			logprobs: null,
		}],
		usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
	}), { headers: { "content-type": "application/json", "cf-aig-log-id": "gateway-log-one" } });
}

export function responsesCompletionResponse(content = "completion", model = "gpt-5.6-luna") {
	return new Response(JSON.stringify({
		id: "resp-one",
		object: "response",
		status: "completed",
		model,
		output: [{
			id: "msg-one",
			type: "message",
			status: "completed",
			role: "assistant",
			content: [{
				type: "output_text",
				text: content,
				annotations: [],
				logprobs: [],
			}],
		}],
		usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
	}), { headers: { "content-type": "application/json", "cf-aig-log-id": "gateway-log-response-one" } });
}

export function streamingCompletionResponse(content = "completion", model = "gpt-5-mini", includeDone = true) {
	const splitAt = Math.max(1, Math.floor(content.length / 2));
	const events = [
		{
			id: "chatcmpl-stream-one",
			object: "chat.completion.chunk",
			model,
			choices: [{ index: 0, delta: { role: "assistant", content: content.slice(0, splitAt) }, finish_reason: null }],
			usage: null,
		},
		{
			id: "chatcmpl-stream-one",
			object: "chat.completion.chunk",
			model,
			choices: [{ index: 0, delta: { content: content.slice(splitAt) }, finish_reason: "stop" }],
			usage: null,
		},
		{
			id: "chatcmpl-stream-one",
			object: "chat.completion.chunk",
			model,
			choices: [],
			usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
		},
	];
	const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}${includeDone ? "data: [DONE]\n\n" : ""}`;
	return new Response(body, { headers: { "content-type": "text/event-stream", "cf-aig-log-id": "gateway-log-stream-one" } });
}

export function successfulResponse(model: typeof CLOUDFLARE_HOSTED_MODEL_IDS[number]) {
	if (model === "openai/gpt-5-mini") return streamingCompletionResponse();
	if (model === "openai/gpt-5.6-luna") return responsesCompletionResponse();
	return completionResponse(model);
}
