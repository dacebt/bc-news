import { LmStudioDeterministicError } from "./lmstudio-errors";

export function lmStudioSdkBaseUrl(rawBaseUrl: string): string {
	if (rawBaseUrl === "" || rawBaseUrl.trim() !== rawBaseUrl) {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio base URL must be nonblank and contain no surrounding whitespace",
		);
	}

	let baseUrl: URL;
	try {
		baseUrl = new URL(rawBaseUrl);
	} catch (cause) {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio base URL is not a valid URL",
			{ cause },
		);
	}

	if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio base URL must use HTTP or HTTPS",
		);
	}
	if (baseUrl.username !== "" || baseUrl.password !== "") {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio base URL must not include credentials",
		);
	}
	if (baseUrl.search !== "" || baseUrl.hash !== "") {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio base URL must not include a query or fragment",
		);
	}
	if (!["/", "/v1", "/v1/"].includes(baseUrl.pathname)) {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio base URL path must be root or /v1",
		);
	}

	baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
	return baseUrl.origin;
}
