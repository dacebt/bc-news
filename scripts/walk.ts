import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EditionSchema } from "@bc-news/contracts";

const ACTIVE_REGION_ID = "7";
const PUBLICATION_DATE = "2026-01-25";
const UNPUBLISHED_PUBLICATION_DATE = "2026-01-26";
const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EDITION_URL = `${BASE_URL}/api/edition?active_region_id=${ACTIVE_REGION_ID}&publication_date=${PUBLICATION_DATE}`;
const GENERATION_RUN_STATUS_URL = `${BASE_URL}/generation-run/generation-run-${ACTIVE_REGION_ID}-${PUBLICATION_DATE}`;
const BROWSER_URL = `http://localhost:${PORT}/?active_region_id=${ACTIVE_REGION_ID}&publication_date=${PUBLICATION_DATE}`;
const READINESS_TIMEOUT_MS = 90_000;
const PUBLISH_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const SHUTDOWN_GRACE_MS = 10_000;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generationDir = join(repoRoot, "apps", "generation");
const nonInteractive =
	process.argv.includes("--non-interactive") || process.env["WALK_NON_INTERACTIVE"] === "1";

class WalkFailure extends Error {}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new WalkFailure(`${command} ${args.join(" ")} exited with code ${String(code)}`));
			}
		});
	});
}

interface WranglerDev {
	child: ChildProcess;
	listening: Promise<void>;
}

/**
 * Every assertion must be answered by the wrangler dev this run spawned — an
 * orphaned or concurrent server on the port could otherwise serve a stale
 * edition and certify a build the walk never executed. So the port must be
 * silent before spawning, and readiness is the child's own "Ready on" line.
 */
async function assertPortSilent(): Promise<void> {
	let occupied = true;
	try {
		await fetch(`${BASE_URL}/api/edition`);
	} catch {
		occupied = false;
	}
	if (occupied) {
		throw new WalkFailure(
			`port ${String(PORT)} is already answering before wrangler dev was spawned — stop the other server (an orphaned wrangler dev from a previous walk?) and re-run`,
		);
	}
}

function startWranglerDev(persistDir: string): WranglerDev {
	const child = spawn(
		"pnpm",
		["exec", "wrangler", "dev", "--port", String(PORT), "--persist-to", persistDir],
		{ cwd: generationDir, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	const listening = new Promise<void>((resolve, reject) => {
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			if (output.includes("Ready on") && output.includes(`:${String(PORT)}`)) {
				resolve();
			}
		});
		child.once("exit", (code) => {
			reject(
				new WalkFailure(
					`wrangler dev exited with code ${String(code)} before reporting Ready on port ${String(PORT)}`,
				),
			);
		});
	});
	child.stdout?.pipe(process.stdout);
	child.stderr?.pipe(process.stderr);
	return { child, listening };
}

async function stopWranglerDev(child: ChildProcess): Promise<void> {
	if (child.pid === undefined || child.exitCode !== null) {
		return;
	}
	const processGroup = -child.pid;
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	process.kill(processGroup, "SIGINT");
	const forceKill = setTimeout(() => {
		try {
			process.kill(processGroup, "SIGKILL");
		} catch {
			// the process group is already gone
		}
	}, SHUTDOWN_GRACE_MS);
	forceKill.unref();
	await exited;
	clearTimeout(forceKill);
}

async function waitForReadiness(wranglerDev: WranglerDev): Promise<void> {
	let readyTimer: NodeJS.Timeout | undefined;
	const readyTimeout = new Promise<never>((_, reject) => {
		readyTimer = setTimeout(() => {
			reject(new WalkFailure(`wrangler dev not ready within ${READINESS_TIMEOUT_MS} ms`));
		}, READINESS_TIMEOUT_MS);
	});
	try {
		await Promise.race([wranglerDev.listening, readyTimeout]);
	} finally {
		clearTimeout(readyTimer);
	}

	const deadline = Date.now() + READINESS_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (wranglerDev.child.exitCode !== null) {
			throw new WalkFailure("wrangler dev exited while the walk was probing readiness");
		}
		let status: number | undefined;
		try {
			status = (await fetch(`${BASE_URL}/api/edition`)).status;
		} catch {
			await sleep(POLL_INTERVAL_MS);
			continue;
		}
		if (status === 400) {
			return;
		}
		throw new WalkFailure(
			`readiness probe expected 400 for /api/edition without identity params, got ${String(status)}`,
		);
	}
	throw new WalkFailure(`wrangler dev not ready within ${READINESS_TIMEOUT_MS} ms`);
}

async function triggerGenerationRun(): Promise<{ status: number; body: string }> {
	const response = await fetch(`${BASE_URL}/generation-run`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			active_region_id: ACTIVE_REGION_ID,
			publication_date: PUBLICATION_DATE,
		}),
	});
	return { status: response.status, body: await response.text() };
}

async function printGenerationRunStatus(): Promise<void> {
	try {
		const response = await fetch(GENERATION_RUN_STATUS_URL);
		console.error(`walk: generation run status (${response.status}): ${await response.text()}`);
	} catch (error) {
		console.error(`walk: could not fetch generation run status: ${String(error)}`);
	}
}

async function pollPublishedEdition(): Promise<string> {
	const deadline = Date.now() + PUBLISH_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const response = await fetch(EDITION_URL);
		if (response.status === 200) {
			const body = await response.text();
			EditionSchema.parse(JSON.parse(body));
			return body;
		}
		if (response.status !== 404) {
			throw new WalkFailure(
				`edition read returned ${response.status} while waiting for publish: ${await response.text()}`,
			);
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await printGenerationRunStatus();
	throw new WalkFailure(`edition not published within ${PUBLISH_TIMEOUT_MS} ms`);
}

async function probeIdempotency(firstServedEdition: string): Promise<void> {
	const duplicate = await triggerGenerationRun();
	console.log(
		`walk: duplicate generation run signal recorded: ${duplicate.status} ${duplicate.body}`,
	);
	if (duplicate.status !== 202 && duplicate.status !== 409) {
		throw new WalkFailure(
			`duplicate trigger expected the recorded local no-op 202 or the documented 409, got ${duplicate.status}`,
		);
	}
	const response = await fetch(EDITION_URL);
	if (response.status !== 200) {
		throw new WalkFailure(`edition read after duplicate trigger returned ${response.status}`);
	}
	const servedAgain = await response.text();
	if (servedAgain !== firstServedEdition) {
		throw new WalkFailure("edition served after duplicate trigger is not byte-identical");
	}
	console.log("walk: duplicate trigger served a byte-identical edition");
}

async function probeUnknownPair(): Promise<void> {
	const response = await fetch(
		`${BASE_URL}/api/edition?active_region_id=${ACTIVE_REGION_ID}&publication_date=${UNPUBLISHED_PUBLICATION_DATE}`,
	);
	if (response.status !== 404) {
		throw new WalkFailure(`unknown pair expected 404, got ${response.status}`);
	}
	console.log("walk: unknown pair answered 404");
}

async function probeClientHtml(): Promise<void> {
	const response = await fetch(`${BASE_URL}/`);
	const contentType = response.headers.get("Content-Type") ?? "";
	if (response.status !== 200 || !contentType.includes("text/html")) {
		throw new WalkFailure(
			`client HTML expected 200 text/html, got ${response.status} ${contentType}`,
		);
	}
	console.log("walk: client HTML served with 200");
}

async function runAssertions(wranglerDev: WranglerDev): Promise<void> {
	await waitForReadiness(wranglerDev);
	const trigger = await triggerGenerationRun();
	if (trigger.status !== 202) {
		throw new WalkFailure(`generation run trigger expected 202, got ${trigger.status} ${trigger.body}`);
	}
	console.log(`walk: generation run accepted: ${trigger.body}`);
	const servedEdition = await pollPublishedEdition();
	console.log("walk: published edition served and parsed against EditionSchema");
	await probeIdempotency(servedEdition);
	await probeUnknownPair();
	await probeClientHtml();
}

let interactiveHoldRelease: (() => void) | undefined;

async function holdForHumanObservation(): Promise<void> {
	console.log("walk: holding wrangler dev for browser observation — Ctrl-C to stop");
	await new Promise<void>((resolve) => {
		interactiveHoldRelease = resolve;
		process.once("SIGINT", resolve);
	});
	interactiveHoldRelease = undefined;
}

async function main(): Promise<void> {
	console.log("walk: building workspace");
	await runCommand("pnpm", ["typecheck"], repoRoot);
	await runCommand("pnpm", ["-r", "build"], repoRoot);

	const persistDir = await mkdtemp(join(tmpdir(), "bc-news-walk-"));
	console.log(`walk: applying local D1 migrations (persist dir ${persistDir})`);
	await runCommand(
		"pnpm",
		["exec", "wrangler", "d1", "migrations", "apply", "bc-news-editions", "--local", "--persist-to", persistDir],
		generationDir,
	);

	console.log("walk: starting wrangler dev");
	await assertPortSilent();
	const wranglerDev = startWranglerDev(persistDir);
	process.on("SIGINT", () => {
		if (interactiveHoldRelease === undefined) {
			void stopWranglerDev(wranglerDev.child)
				.then(() => rm(persistDir, { recursive: true, force: true }))
				.finally(() => process.exit(130));
		}
	});
	try {
		await runAssertions(wranglerDev);
		console.log("WALK PASS");
		console.log(BROWSER_URL);
		if (!nonInteractive) {
			await holdForHumanObservation();
		}
	} finally {
		await stopWranglerDev(wranglerDev.child);
		await rm(persistDir, { recursive: true, force: true });
	}
}

main().catch((error: unknown) => {
	console.error(`WALK FAIL: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
