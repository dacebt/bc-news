import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

const MAX_REQUEST_BYTES = 1_000_000;

const ChatCompletionRequestSchema = z.strictObject({
	model: z.string().trim().min(1),
	messages: z.tuple([
		z.strictObject({ role: z.literal("system"), content: z.string().min(1) }),
		z.strictObject({ role: z.literal("user"), content: z.string().min(1) }),
	]),
});

export interface ObservedModelRequest {
	readonly model: string;
	readonly system: string;
	readonly user: string;
}

export interface RecordLoopbackServer {
	readonly baseUrl: string;
	readonly requests: readonly ObservedModelRequest[];
	readonly waitForRequests: (models: readonly string[]) => Promise<void>;
	readonly releaseRequests: (models: readonly string[]) => void;
	readonly close: () => Promise<void>;
}

interface RequestSignal {
	readonly observed: Promise<void>;
	readonly markObserved: () => void;
	readonly released: Promise<void>;
	readonly release: () => void;
}

class LoopbackRequestError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "LoopbackRequestError";
		this.status = status;
		this.code = code;
	}
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "Content-Type": "application/json" });
	response.end(JSON.stringify(body));
}

function requestSignal(held: boolean): RequestSignal {
	let markObserved = (): void => undefined;
	const observed = new Promise<void>((resolve) => { markObserved = resolve; });
	let release = (): void => undefined;
	const released = held
		? new Promise<void>((resolve) => { release = resolve; })
		: Promise.resolve();
	return { observed, markObserved, released, release };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	request.setEncoding("utf8");
	let body = "";
	for await (const chunk of request) {
		body += chunk;
		if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
			throw new LoopbackRequestError(413, "request_too_large", "Loopback request exceeded its byte limit");
		}
	}
	try {
		return JSON.parse(body) as unknown;
	} catch (cause) {
		throw new LoopbackRequestError(400, "invalid_json", "Loopback request body is not valid JSON", { cause });
	}
}

async function handleRequest(input: {
	readonly request: IncomingMessage;
	readonly response: ServerResponse;
	readonly outputByModel: Readonly<Record<string, string>>;
	readonly observedRequests: ObservedModelRequest[];
	readonly retryableFailureModels: ReadonlySet<string>;
	readonly transientFailureModels: ReadonlySet<string>;
	readonly requestCountByModel: Map<string, number>;
	readonly requestSignals: ReadonlyMap<string, RequestSignal>;
}): Promise<void> {
	const url = new URL(input.request.url ?? "/", "http://127.0.0.1");
	if (
		input.request.method !== "POST" ||
		url.pathname !== "/v1/chat/completions" ||
		url.search !== ""
	) {
		throw new LoopbackRequestError(404, "route_not_found", "Loopback route does not exist");
	}
	if (input.request.headers["content-type"] !== "application/json") {
		throw new LoopbackRequestError(415, "content_type_rejected", "Loopback request must be JSON");
	}
	if (input.request.headers.authorization !== "Bearer record-loopback-proof") {
		throw new LoopbackRequestError(401, "authorization_rejected", "Loopback authorization was rejected");
	}

	const parsed = ChatCompletionRequestSchema.safeParse(await readJsonBody(input.request));
	if (!parsed.success) {
		throw new LoopbackRequestError(400, "request_contract_rejected", "Loopback request did not match the strict chat contract");
	}
	const output = input.outputByModel[parsed.data.model];
	if (output === undefined) {
		throw new LoopbackRequestError(400, "model_not_registered", "Loopback request named an unregistered model");
	}
	input.observedRequests.push({
		model: parsed.data.model,
		system: parsed.data.messages[0].content,
		user: parsed.data.messages[1].content,
	});
	const signal = input.requestSignals.get(parsed.data.model);
	if (signal === undefined) throw new LoopbackRequestError(500, "request_signal_missing", "Loopback request has no control signal");
	signal.markObserved();
	await signal.released;
	const requestCount = (input.requestCountByModel.get(parsed.data.model) ?? 0) + 1;
	input.requestCountByModel.set(parsed.data.model, requestCount);
	if (input.retryableFailureModels.has(parsed.data.model) || (input.transientFailureModels.has(parsed.data.model) && requestCount === 1)) {
		throw new LoopbackRequestError(503, "controlled_retryable_failure", "Controlled retryable evaluation transport failure");
	}
	respondJson(input.response, 200, {
		model: parsed.data.model,
		choices: [{ message: { role: "assistant", content: output } }],
		usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
}

export function startRecordLoopbackServer(
	outputByModel: Readonly<Record<string, string>>,
	options: {
		readonly retryableFailureModels?: ReadonlySet<string>;
		readonly transientFailureModels?: ReadonlySet<string>;
		readonly heldModels?: ReadonlySet<string>;
	} = {},
): Promise<RecordLoopbackServer> {
	const observedRequests: ObservedModelRequest[] = [];
	const retryableFailureModels = options.retryableFailureModels ?? new Set<string>();
	const transientFailureModels = options.transientFailureModels ?? new Set<string>();
	const heldModels = options.heldModels ?? new Set<string>();
	if ([...retryableFailureModels].some((model) => transientFailureModels.has(model))) {
		return Promise.reject(new Error("A loopback model cannot be configured for both transient and persistent retryable failure"));
	}
	const registeredModels = new Set(Object.keys(outputByModel));
	const unknownHeldModel = [...heldModels].find((model) => !registeredModels.has(model));
	if (unknownHeldModel !== undefined) return Promise.reject(new Error(`Cannot hold unregistered loopback model ${unknownHeldModel}`));
	const requestSignals = new Map([...registeredModels].map((model) => [model, requestSignal(heldModels.has(model))]));
	const requestCountByModel = new Map<string, number>();
	return new Promise((resolve, reject) => {
		const server = createServer((request, response) => {
			void handleRequest({ request, response, outputByModel, observedRequests, retryableFailureModels, transientFailureModels, requestCountByModel, requestSignals }).catch((cause: unknown) => {
				const error = cause instanceof LoopbackRequestError
					? cause
					: new LoopbackRequestError(500, "unexpected_failure", "Loopback request failed unexpectedly", { cause });
				respondJson(response, error.status, { error: { code: error.code, message: error.message } });
			});
		});
		const startError = (error: Error): void => reject(error);
		server.once("error", startError);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", startError);
			const address = server.address();
			if (address === null || typeof address === "string") {
				void closeServer(server).finally(() => reject(new Error("record loopback server did not bind to a TCP port")));
				return;
			}
			resolve({
				baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
				requests: observedRequests,
				waitForRequests: async (models) => {
					await Promise.all(models.map((model) => {
						const signal = requestSignals.get(model);
						if (signal === undefined) throw new Error(`Cannot wait for unregistered loopback model ${model}`);
						return signal.observed;
					}));
				},
				releaseRequests: (models) => {
					for (const model of models) {
						const signal = requestSignals.get(model);
						if (signal === undefined) throw new Error(`Cannot release unregistered loopback model ${model}`);
						signal.release();
					}
				},
				close: async () => {
					for (const signal of requestSignals.values()) signal.release();
					await closeServer(server);
				},
			});
		});
	});
}
