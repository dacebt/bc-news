import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { GenerationRunParams } from "@bc-news/contracts";
import { queueGenerationRunStatus } from "../src/generation-run-status";
import { dispatchGenerationRequest } from "../src/index";

const OPERATOR_TOKEN = "test-operator-token";

function operatorHeaders(contentType = "application/json"): HeadersInit {
	return {
		Authorization: `Bearer ${OPERATOR_TOKEN}`,
		"Content-Type": contentType,
	};
}

function launchRequest(
	body: BodyInit | null,
	headers: HeadersInit = operatorHeaders(),
): Request {
	return new Request("http://worker.local/generation-run", {
		method: "POST",
		headers,
		body,
	});
}

function statusRequest(publicationDate: string, authorization = true): Request {
	return new Request(
		`http://worker.local/generation-run?active_region_id=7&publication_date=${publicationDate}`,
		authorization ? { headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` } } : {},
	);
}

function envWith(
	create: ReturnType<typeof vi.fn> = vi.fn(),
	get: ReturnType<typeof vi.fn> = vi.fn().mockRejectedValue(new Error("not found")),
	operatorToken: unknown = OPERATOR_TOKEN,
): Env {
	return {
		...env,
		OPERATOR_API_TOKEN: operatorToken,
		GENERATION_RUN: { create, get } as unknown as Workflow<GenerationRunParams>,
	} as Env;
}

function envWithoutOperatorToken(create: ReturnType<typeof vi.fn> = vi.fn()): Env {
	const generationEnv = envWith(create) as Env & { OPERATOR_API_TOKEN?: string };
	Reflect.deleteProperty(generationEnv, "OPERATOR_API_TOKEN");
	return generationEnv;
}

async function queuedRowCount(activeRegionId: string, publicationDate: string): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COUNT(*) AS count FROM generation_run_status WHERE active_region_id = ?1 AND publication_date = ?2",
	).bind(activeRegionId, publicationDate).first<{ count: number }>();
	return row?.count ?? 0;
}

function expectNoStore(response: Response): void {
	expect(response.headers.get("Cache-Control")).toBe("no-store");
}

it("binds the operator token in the Worker test runtime", () => {
	expect(env.OPERATOR_API_TOKEN).toBe(OPERATOR_TOKEN);
});

it("rejects unauthenticated operator requests before Workflow or D1 effects", async () => {
	const create = vi.fn();
	const get = vi.fn();
	const publicationDate = "2026-04-01";
	const generationEnv = envWith(create, get);

	const launch = await dispatchGenerationRequest(
		launchRequest(
			JSON.stringify({ active_region_id: "7", publication_date: publicationDate }),
			{ "Content-Type": "application/json" },
		),
		generationEnv,
	);
	const status = await dispatchGenerationRequest(statusRequest(publicationDate, false), generationEnv);

	expect(launch.status).toBe(401);
	expect(launch.headers.get("WWW-Authenticate")).toBe("Bearer");
	expect(status.status).toBe(401);
	expectNoStore(launch);
	expectNoStore(status);
	expect(create).not.toHaveBeenCalled();
	expect(get).not.toHaveBeenCalled();
	expect(await queuedRowCount("7", publicationDate)).toBe(0);
});

it.each([
	["wrong bearer", `Bearer ${OPERATOR_TOKEN}-wrong`, "2026-04-09"],
	["wrong scheme", `Basic ${OPERATOR_TOKEN}`, "2026-04-10"],
	["padded bearer", `Bearer  ${OPERATOR_TOKEN}`, "2026-04-11"],
])("rejects %s before Workflow or D1 effects", async (_label, authorization, publicationDate) => {
	const create = vi.fn();
	const response = await dispatchGenerationRequest(
		launchRequest(
			JSON.stringify({ active_region_id: "7", publication_date: publicationDate }),
			{ Authorization: authorization, "Content-Type": "application/json" },
		),
		envWith(create),
	);

	expect(response.status).toBe(401);
	expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
	expectNoStore(response);
	expect(create).not.toHaveBeenCalled();
	expect(await queuedRowCount("7", publicationDate)).toBe(0);
});

it("fails closed when OPERATOR_API_TOKEN is missing", async () => {
	const create = vi.fn();
	const response = await dispatchGenerationRequest(
		launchRequest(JSON.stringify({ active_region_id: "7", publication_date: "2026-04-02" })),
		envWithoutOperatorToken(create),
	);

	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({ error: "operator_auth_unavailable" });
	expectNoStore(response);
	expect(create).not.toHaveBeenCalled();
});

it.each(["", "   ", " token-with-padding "])(
	"fails closed when OPERATOR_API_TOKEN is not usable",
	async (operatorToken) => {
		const create = vi.fn();
		const response = await dispatchGenerationRequest(
			launchRequest(JSON.stringify({ active_region_id: "7", publication_date: "2026-04-02" })),
			envWith(create, vi.fn(), operatorToken),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "operator_auth_unavailable" });
		expectNoStore(response);
		expect(create).not.toHaveBeenCalled();
	},
);

it("launches with an exact bearer token and parameterized JSON media type", async () => {
	const create = vi.fn().mockResolvedValue({ id: "generation-run-7-2026-04-03" });
	const response = await dispatchGenerationRequest(
		launchRequest(
			JSON.stringify({ active_region_id: "7", publication_date: "2026-04-03" }),
			operatorHeaders("application/json; charset=utf-8"),
		),
		envWith(create),
	);

	expect(response.status).toBe(202);
	expect(await response.json()).toMatchObject({
		id: "generation-run-7-2026-04-03",
		active_region_id: "7",
		publication_date: "2026-04-03",
	});
	expectNoStore(response);
	expect(create).toHaveBeenCalledOnce();
});

it("rejects unsupported media and bodies over 1 KiB without trusting Content-Length", async () => {
	const create = vi.fn();
	const generationEnv = envWith(create);
	const unsupported = await dispatchGenerationRequest(
		launchRequest("{}", operatorHeaders("text/plain")),
		generationEnv,
	);
	const oversized = await dispatchGenerationRequest(
		launchRequest("x".repeat(1025), {
			...operatorHeaders(),
			"Content-Length": "1",
		}),
		generationEnv,
	);

	expect(unsupported.status).toBe(415);
	expect(oversized.status).toBe(413);
	expectNoStore(unsupported);
	expectNoStore(oversized);
	expect(create).not.toHaveBeenCalled();
});

it.each([
	["malformed JSON", "{", "7", "2026-04-04"],
	["invalid schema", JSON.stringify({ active_region_id: "7" }), "7", "2026-04-05"],
	[
		"inactive region",
		JSON.stringify({ active_region_id: "10", publication_date: "2026-04-06" }),
		"10",
		"2026-04-06",
	],
])("rejects %s before Workflow or D1 effects", async (_label, body, activeRegionId, publicationDate) => {
	const create = vi.fn();
	const response = await dispatchGenerationRequest(launchRequest(body), envWith(create));

	expect(response.status).toBe(400);
	expectNoStore(response);
	expect(create).not.toHaveBeenCalled();
	expect(await queuedRowCount(activeRegionId, publicationDate)).toBe(0);
});

it("returns pair-addressed operator status with a strict projection and no-store", async () => {
	const params = { active_region_id: "7", publication_date: "2026-04-07" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-14T12:00:00.000Z");
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({ status: "queued", output: { platform: "private" } }),
	});
	const response = await dispatchGenerationRequest(
		statusRequest(params.publication_date),
		envWith(vi.fn(), get),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		active_region_id: "7",
		publication_date: params.publication_date,
		generation_run_id: "generation-run-7-2026-04-07",
		workflow: { observation: "available", status: "queued", error: null },
	});
	expectNoStore(response);
});

it.each([false, true])("keeps raw Workflow-ID paths absent with authorization=%s", async (authorized) => {
	const get = vi.fn();
	const request = new Request(
		"http://worker.local/generation-run/raw-workflow-id",
		authorized ? { headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` } } : {},
	);
	const response = await dispatchGenerationRequest(request, envWith(vi.fn(), get));

	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: "route_not_found" });
	expectNoStore(response);
	expect(get).not.toHaveBeenCalled();
});

it("sanitizes unexpected operator failures", async () => {
	const params = { active_region_id: "7", publication_date: "2026-04-08" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-14T12:00:00.000Z");
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({ status: "invented", secret: "must-not-leak" }),
	});
	const response = await dispatchGenerationRequest(
		statusRequest(params.publication_date),
		envWith(vi.fn(), get),
	);

	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({ error: "operator_request_failed" });
	expectNoStore(response);
});

it("sanitizes unavailable Workflow observation details", async () => {
	const params = { active_region_id: "7", publication_date: "2026-04-12" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-14T12:00:00.000Z");
	const response = await dispatchGenerationRequest(
		statusRequest(params.publication_date),
		envWith(vi.fn(), vi.fn().mockRejectedValue(new Error("internal account/instance detail"))),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		workflow: {
			observation: "unavailable",
			error: {
				name: "WorkflowObservationUnavailable",
				message: "Workflow status is unavailable",
			},
		},
	});
	expectNoStore(response);
});

it("leaves the published edition route public", async () => {
	const response = await dispatchGenerationRequest(
		new Request("http://worker.local/api/edition"),
		envWith(),
	);

	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({ error: "invalid_edition_request" });
});
