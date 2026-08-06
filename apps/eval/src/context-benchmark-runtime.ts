import { LMStudioClient, type LLM } from "@lmstudio/sdk";

export type ContextBenchmarkRuntimeErrorCode =
	| "invalid_lmstudio_base_url"
	| "no_loaded_llm"
	| "multiple_loaded_llms"
	| "loaded_llm_not_qwen";

export class ContextBenchmarkRuntimeError extends Error {
	readonly code: ContextBenchmarkRuntimeErrorCode;

	constructor(code: ContextBenchmarkRuntimeErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ContextBenchmarkRuntimeError";
		this.code = code;
	}
}

export interface ContextBenchmarkPrompt {
	readonly system: string;
	readonly user: string;
}

export interface ContextBenchmarkModel {
	readonly identifier: string;
	readonly modelKey: string;
	readonly path: string;
	readonly displayName: string;
	readonly contextLength: number;
	applyPromptTemplate(prompt: ContextBenchmarkPrompt): Promise<string>;
	countTokens(text: string): Promise<number>;
}

export interface ContextBenchmarkRuntime {
	getOnlyLoadedQwen(): Promise<ContextBenchmarkModel>;
	close(): Promise<void>;
}

function invalidBaseUrl(message: string, cause?: unknown): ContextBenchmarkRuntimeError {
	return new ContextBenchmarkRuntimeError(
		"invalid_lmstudio_base_url",
		message,
		cause === undefined ? undefined : { cause },
	);
}

export function lmStudioSdkBaseUrl(openAiBaseUrl: string): string {
	if (openAiBaseUrl.trim() !== openAiBaseUrl || openAiBaseUrl === "") {
		throw invalidBaseUrl("LM Studio base URL must be nonblank and contain no surrounding whitespace");
	}

	let url: URL;
	try {
		url = new URL(openAiBaseUrl);
	} catch (cause) {
		throw invalidBaseUrl("LM Studio base URL is not a valid URL", cause);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw invalidBaseUrl("LM Studio base URL must use HTTP or HTTPS");
	}
	if (url.username !== "" || url.password !== "") {
		throw invalidBaseUrl("LM Studio base URL must not include credentials");
	}
	if (url.search !== "" || url.hash !== "") {
		throw invalidBaseUrl("LM Studio base URL must not include a query or fragment");
	}
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.origin;
}

function identifiesQwen(model: Pick<LLM, "identifier" | "modelKey" | "path" | "displayName">): boolean {
	return [model.identifier, model.modelKey, model.path, model.displayName].some((value) =>
		/(?:^|[^a-z0-9])qwen(?=\d|[^a-z0-9]|$)/i.test(value),
	);
}

function adaptLoadedModel(model: LLM, contextLength: number): ContextBenchmarkModel {
	return {
		identifier: model.identifier,
		modelKey: model.modelKey,
		path: model.path,
		displayName: model.displayName,
		contextLength,
		applyPromptTemplate: (prompt) =>
			model.applyPromptTemplate([
				{ role: "system", content: prompt.system },
				{ role: "user", content: prompt.user },
			]),
		countTokens: (text) => model.countTokens(text),
	};
}

class LmStudioContextBenchmarkRuntime implements ContextBenchmarkRuntime {
	readonly #client: LMStudioClient;
	#closed = false;

	constructor(baseUrl: string) {
		this.#client = new LMStudioClient({ baseUrl });
	}

	async getOnlyLoadedQwen(): Promise<ContextBenchmarkModel> {
		const models = await this.#client.llm.listLoaded();
		if (models.length === 0) {
			throw new ContextBenchmarkRuntimeError("no_loaded_llm", "LM Studio has no loaded LLM");
		}
		if (models.length !== 1) {
			throw new ContextBenchmarkRuntimeError(
				"multiple_loaded_llms",
				`LM Studio must have exactly one loaded LLM; found ${models.length}`,
			);
		}

		const model = models[0];
		if (model === undefined) {
			throw new ContextBenchmarkRuntimeError("no_loaded_llm", "LM Studio has no loaded LLM");
		}
		if (!identifiesQwen(model)) {
			throw new ContextBenchmarkRuntimeError(
				"loaded_llm_not_qwen",
				"The only loaded LM Studio LLM is not identified as Qwen by its metadata",
			);
		}

		return adaptLoadedModel(model, await model.getContextLength());
	}

	async close(): Promise<void> {
		if (this.#closed) {
			return;
		}
		this.#closed = true;
		await this.#client[Symbol.asyncDispose]();
	}
}

export function createLmStudioContextBenchmarkRuntime(openAiBaseUrl: string): ContextBenchmarkRuntime {
	return new LmStudioContextBenchmarkRuntime(lmStudioSdkBaseUrl(openAiBaseUrl));
}
