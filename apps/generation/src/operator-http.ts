const BEARER_SCHEME = "Bearer ";
const NO_STORE = "no-store";

type OperatorHandler = () => Promise<Response>;

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function noStoreResponse(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", NO_STORE);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function configuredOperatorToken(env: Env): string | undefined {
	const token = env.OPERATOR_API_TOKEN;
	if (typeof token !== "string" || token.length === 0 || token.trim() !== token) {
		return undefined;
	}
	return token;
}

function bearerToken(request: Request): string | undefined {
	const authorization = request.headers.get("Authorization");
	if (authorization === null || !authorization.startsWith(BEARER_SCHEME)) {
		return undefined;
	}
	const token = authorization.slice(BEARER_SCHEME.length);
	return token.length > 0 && token.trim() === token ? token : undefined;
}

async function digest(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function tokensMatch(actual: string, expected: string): Promise<boolean> {
	const [actualDigest, expectedDigest] = await Promise.all([digest(actual), digest(expected)]);
	let difference = 0;
	for (let index = 0; index < actualDigest.length; index += 1) {
		const actualByte = actualDigest[index];
		const expectedByte = expectedDigest[index];
		if (actualByte === undefined || expectedByte === undefined) return false;
		difference |= actualByte ^ expectedByte;
	}
	return difference === 0;
}

export async function protectOperatorRoute(
	request: Request,
	env: Env,
	handler: OperatorHandler,
): Promise<Response> {
	try {
		const expectedToken = configuredOperatorToken(env);
		if (expectedToken === undefined) {
			return noStoreResponse(jsonResponse(500, { error: "operator_auth_unavailable" }));
		}

		const actualToken = bearerToken(request);
		if (actualToken === undefined || !(await tokensMatch(actualToken, expectedToken))) {
			return noStoreResponse(jsonResponse(
				401,
				{ error: "unauthorized" },
				{ "WWW-Authenticate": "Bearer" },
			));
		}

		return noStoreResponse(await handler());
	} catch (error) {
		console.error("operator request failed", {
			name: error instanceof Error ? error.name : "UnknownError",
		});
		return noStoreResponse(jsonResponse(500, { error: "operator_request_failed" }));
	}
}
