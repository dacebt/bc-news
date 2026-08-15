import type { GenerationRunParams } from "@bc-news/contracts";
import {
	fetchGenerationRunStatus,
	generationRunStatusUrl,
	requestGenerationRunStatus,
} from "../generation-run-status";
import type { WalkContext, WalkPhase } from "../phase";

interface HttpObservation {
	status: number;
	body: string;
	cacheControl: string | null;
}

function authorizationHeaders(operatorToken: string): Headers {
	return new Headers({ Authorization: `Bearer ${operatorToken}` });
}

async function observe(response: Response): Promise<HttpObservation> {
	return {
		status: response.status,
		body: await response.text(),
		cacheControl: response.headers.get("cache-control"),
	};
}

function assertStatus(observation: HttpObservation, expected: number, operation: string): void {
	if (observation.status !== expected) {
		throw new Error(
			`${operation} expected ${String(expected)}, got ${String(observation.status)} ${observation.body}`,
		);
	}
}

function assertNoStore(observation: HttpObservation, operation: string): void {
	const directives = observation.cacheControl
		?.split(",")
		.map((directive) => directive.trim().toLowerCase());
	if (!directives?.includes("no-store")) {
		throw new Error(
			`${operation} expected Cache-Control: no-store, got ${JSON.stringify(observation.cacheControl)}`,
		);
	}
}

async function launchGeneration(
	baseUrl: string,
	pair: GenerationRunParams,
	operatorToken?: string,
): Promise<HttpObservation> {
	const headers = new Headers({ "Content-Type": "application/json" });
	if (operatorToken !== undefined) {
		headers.set("Authorization", `Bearer ${operatorToken}`);
	}
	return observe(await fetch(`${baseUrl}/generation-run`, {
		method: "POST",
		headers,
		body: JSON.stringify(pair),
	}));
}

async function observeUnauthenticatedStatus(
	baseUrl: string,
	pair: GenerationRunParams,
): Promise<HttpObservation> {
	return observe(await fetch(generationRunStatusUrl(baseUrl, pair)));
}

async function observeRawId(
	baseUrl: string,
	operatorToken?: string,
): Promise<HttpObservation> {
	const url = `${baseUrl}/generation-run/walk-boundary-probe`;
	if (operatorToken === undefined) {
		return observe(await fetch(url));
	}
	return observe(await fetch(url, { headers: authorizationHeaders(operatorToken) }));
}

async function run(ctx: WalkContext): Promise<void> {
	const boundaryPair = ctx.unpublishedPair;
	const unauthorizedLaunch = await launchGeneration(ctx.baseUrl, boundaryPair);
	assertStatus(unauthorizedLaunch, 401, "unauthenticated generation launch");
	assertNoStore(unauthorizedLaunch, "unauthenticated generation launch");
	const wrongTokenLaunch = await launchGeneration(
		ctx.baseUrl,
		boundaryPair,
		`${ctx.operatorToken}-wrong`,
	);
	assertStatus(wrongTokenLaunch, 401, "wrong-token generation launch");
	assertNoStore(wrongTokenLaunch, "wrong-token generation launch");

	const unauthorizedStatus = await observeUnauthenticatedStatus(ctx.baseUrl, boundaryPair);
	assertStatus(unauthorizedStatus, 401, "unauthenticated generation status");
	assertNoStore(unauthorizedStatus, "unauthenticated generation status");

	const absentStatus = await requestGenerationRunStatus(
		ctx.baseUrl,
		boundaryPair,
		ctx.operatorToken,
	);
	assertStatus(absentStatus, 404, "authenticated status after rejected launch");
	assertNoStore(absentStatus, "authenticated status after rejected launch");

	const authorizedLaunch = await launchGeneration(ctx.baseUrl, boundaryPair, ctx.operatorToken);
	assertStatus(authorizedLaunch, 202, "authenticated generation launch");
	assertNoStore(authorizedLaunch, "authenticated generation launch");

	await fetchGenerationRunStatus(ctx.baseUrl, boundaryPair, ctx.operatorToken);

	const [unauthorizedRawId, authorizedRawId] = await Promise.all([
		observeRawId(ctx.baseUrl),
		observeRawId(ctx.baseUrl, ctx.operatorToken),
	]);
	assertStatus(unauthorizedRawId, 404, "unauthenticated raw Workflow-ID request");
	assertStatus(authorizedRawId, 404, "authenticated raw Workflow-ID request");
	if (unauthorizedRawId.body !== authorizedRawId.body) {
		throw new Error(
			`raw Workflow-ID requests did not return the same generic 404 body: unauthenticated=${JSON.stringify(unauthorizedRawId.body)} authenticated=${JSON.stringify(authorizedRawId.body)}`,
		);
	}

	console.log(
		"walk: operator boundary rejected missing and wrong credentials without creating work, authorized pair launch/status, and hid raw Workflow IDs",
	);
}

export const walkPhase: WalkPhase = { name: "operator-boundary", run };
