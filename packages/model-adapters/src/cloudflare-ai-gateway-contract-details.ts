import { z } from "zod";
import type {
	CloudflareAiGatewayContractFailureDetails,
	CloudflareAiGatewayContractIssue,
} from "./cloudflare-ai-gateway-errors";

const ProviderHttpErrorSchema = z.looseObject({
	message: z.string().min(1),
	type: z.string().min(1).optional(),
	param: z.string().min(1).nullable().optional(),
	code: z.union([z.string().min(1), z.number()]).nullable().optional(),
});

const ProviderHttpSingleErrorEnvelopeSchema = z.looseObject({ error: ProviderHttpErrorSchema });
const ProviderHttpErrorArrayEnvelopeSchema = z.looseObject({
	errors: z.array(ProviderHttpErrorSchema).min(1),
});

function receivedType(value: unknown): NonNullable<CloudflareAiGatewayContractIssue["received_type"]> {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	const type = typeof value;
	return type === "boolean" || type === "number" || type === "object" || type === "string" ? type : "undefined";
}

function valueAtPath(candidate: unknown, path: readonly PropertyKey[]): unknown {
	let value = candidate;
	for (const segment of path) {
		if (typeof segment === "symbol" || value === null || typeof value !== "object") return undefined;
		value = (value as Record<PropertyKey, unknown>)[segment];
	}
	return value;
}

function boundedProviderMessage(value: string): string {
	return value.length <= 4_000 ? value : `${value.slice(0, 4_000)} [truncated]`;
}

export function cloudflareAiGatewayContractFailureDetails(
	contract: CloudflareAiGatewayContractFailureDetails["contract"],
	candidate: unknown,
	error: z.ZodError,
): CloudflareAiGatewayContractFailureDetails {
	return {
		contract,
		issues: error.issues.map((issue) => ({
			path: issue.path.map((segment) => typeof segment === "symbol" ? segment.toString() : segment),
			code: issue.code,
			...("expected" in issue && typeof issue.expected === "string" ? { expected: issue.expected } : {}),
			received_type: receivedType(valueAtPath(candidate, issue.path)),
			...("keys" in issue && Array.isArray(issue.keys) ? { unexpected_keys: issue.keys.filter((key): key is string => typeof key === "string") } : {}),
		})),
	};
}

export async function cloudflareAiGatewayHttpRejectionDetails(
	response: Response,
): Promise<CloudflareAiGatewayContractFailureDetails> {
	let body: string;
	try {
		body = await response.text();
	} catch {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{ path: [], code: "error_body_read_failed" }],
		};
	}
	if (body === "") {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{ path: [], code: "empty_error_body" }],
		};
	}
	let candidate: unknown;
	try {
		candidate = JSON.parse(body) as unknown;
	} catch {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{
				path: [],
				code: "unstructured_error_body",
				provider_message: boundedProviderMessage(body),
			}],
		};
	}
	const singleError = ProviderHttpSingleErrorEnvelopeSchema.safeParse(candidate);
	const errorArray = ProviderHttpErrorArrayEnvelopeSchema.safeParse(candidate);
	let errors: Array<z.infer<typeof ProviderHttpErrorSchema>>;
	if (singleError.success) {
		errors = [singleError.data.error];
	} else if (errorArray.success) {
		errors = errorArray.data.errors;
	} else {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{ path: [], code: "unrecognized_error_contract", received_type: receivedType(candidate) }],
		};
	}
	return {
		contract: "cloudflare_ai_gateway_http_error_response",
		http_status: response.status,
		issues: errors.map((error, index) => ({
			path: error.param === undefined || error.param === null
				? ["errors", index]
				: [error.param],
			code: "provider_rejection",
			...((error.code ?? error.type) === undefined
				? {}
				: { provider_code: String(error.code ?? error.type) }),
			provider_message: boundedProviderMessage(error.message),
		})),
	};
}
