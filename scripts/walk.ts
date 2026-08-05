import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GenerationRunParams } from "@bc-news/contracts";
import { startBitJitaStubServer, type BitJitaStubServer } from "./walk/bitjita-stub-server";
import type { WalkContext } from "./walk/phase";
import { walkPhases } from "./walk/phases/index";
import { POLL_INTERVAL_MS, sleep } from "./walk/timing";
import { readSingleWranglerCron } from "./walk/wrangler-cron";
import {
	walkGenerationWranglerDevArguments,
	wranglerDevArguments,
} from "./walk/wrangler-dev-command";

const ACTIVE_REGION_ID = "7";
const PUBLICATION_DATE = "2026-01-25";
const SCHEDULED_TIME = 1_769_299_200_000;
const UNPUBLISHED_PUBLICATION_DATE = "2026-01-26";
const DEFAULT_PORT = 8787;
const READINESS_TIMEOUT_MS = 90_000;
const SHUTDOWN_GRACE_MS = 10_000;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generationDir = join(repoRoot, "apps", "generation");
const ingestDir = join(repoRoot, "apps", "ingest");
const nonInteractive =
	process.argv.includes("--non-interactive") || process.env["WALK_NON_INTERACTIVE"] === "1";

class WalkFailure extends Error {
	readonly code = "walk_failure";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "WalkFailure";
	}
}

function parseWalkPort(raw: string | undefined): number {
	if (raw === undefined) {
		return DEFAULT_PORT;
	}
	if (!/^[1-9][0-9]*$/.test(raw)) {
		throw new WalkFailure(
			`WALK_PORT must be a positive integer with no leading/trailing characters, got ${JSON.stringify(raw)}`,
		);
	}
	const parsed = Number(raw);
	if (parsed > 65534) {
		throw new WalkFailure(
			`WALK_PORT must be <= 65534 (the ingest wrangler dev runs on WALK_PORT + 1), got ${JSON.stringify(raw)}`,
		);
	}
	return parsed;
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
 * fetch() throws TypeError both for a refused connection (cause.code
 * ECONNREFUSED — the port is genuinely silent) and for unrelated failures
 * (e.g. cause.code ERR_INVALID_URL from a malformed URL). Only the former is
 * evidence of silence.
 */
function isConnectionRefused(error: unknown): boolean {
	if (!(error instanceof TypeError) || !(error.cause instanceof Error)) {
		return false;
	}
	return (error.cause as NodeJS.ErrnoException).code === "ECONNREFUSED";
}

/**
 * Every assertion must be answered by the wrangler dev this run spawned — an
 * orphaned or concurrent server on the port could otherwise serve a stale
 * edition and certify a build the walk never executed. So the port must be
 * silent before spawning, and readiness is the child's own "Ready on" line.
 */
async function assertPortSilent(checkUrl: string, port: number): Promise<void> {
	let occupied = true;
	try {
		await fetch(checkUrl);
	} catch (error) {
		if (!isConnectionRefused(error)) {
			throw new WalkFailure(
				`could not determine whether port ${String(port)} is silent before spawning wrangler dev: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		occupied = false;
	}
	if (occupied) {
		throw new WalkFailure(
			`port ${String(port)} is already answering before wrangler dev was spawned — stop the other server (an orphaned wrangler dev from a previous walk?) and re-run`,
		);
	}
}

function startWranglerDev(
	cwd: string,
	port: number,
	args: readonly string[],
): WranglerDev {
	const child = spawn(
		"pnpm",
		args,
		{ cwd, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	const listening = new Promise<void>((resolve, reject) => {
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			if (output.includes("Ready on") && output.includes(`:${String(port)}`)) {
				resolve();
			}
		});
		child.once("exit", (code) => {
			reject(
				new WalkFailure(
					`wrangler dev exited with code ${String(code)} before reporting Ready on port ${String(port)}`,
				),
			);
		});
	});
	// The caller may not await `listening` right away — the ingest dev's
	// readiness is only awaited after the generation dev's readiness resolves,
	// tens of seconds later. An early exit in that window would otherwise be
	// an unhandled rejection, and Node terminates the process on those before
	// the walk's own cleanup ever runs. This handler only silences that race;
	// the rejection still propagates, unchanged, to whichever `await`s
	// `listening` later.
	listening.catch(() => {});
	child.stdout?.pipe(process.stdout);
	child.stderr?.pipe(process.stderr);
	return { child, listening };
}

/**
 * Always attempts the process-group kill, even when the leader already
 * exited: a group sibling (e.g. workerd) can outlive the leader and would
 * otherwise orphan the port. `exited` is only awaited when the leader has
 * not already exited — its 'exit' event fired in the past and a fresh
 * listener would never resolve, hanging the walk.
 */
async function stopWranglerDev(child: ChildProcess): Promise<void> {
	if (child.pid === undefined) {
		return;
	}
	const alreadyExited = child.exitCode !== null || child.signalCode !== null;
	const exited = alreadyExited
		? Promise.resolve()
		: new Promise<void>((resolve) => child.once("exit", () => resolve()));
	const processGroup = -child.pid;
	try {
		process.kill(processGroup, "SIGINT");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
			throw error;
		}
	}
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

async function waitForReadiness(
	wranglerDev: WranglerDev,
	probeUrl: string,
	expectedStatus: number,
): Promise<void> {
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
			status = (await fetch(probeUrl)).status;
		} catch {
			await sleep(POLL_INTERVAL_MS);
			continue;
		}
		if (status === expectedStatus) {
			return;
		}
		throw new WalkFailure(
			`readiness probe expected ${String(expectedStatus)} for ${probeUrl}, got ${String(status)}`,
		);
	}
	throw new WalkFailure(`wrangler dev not ready within ${READINESS_TIMEOUT_MS} ms`);
}

interface RunningProcesses {
	wranglerDev: WranglerDev;
	ingestWranglerDev: WranglerDev;
	stubServer: BitJitaStubServer;
}

/**
 * Shuts down every process/server the walk started, regardless of which one
 * failed. allSettled rather than sequential awaits: one teardown hanging or
 * throwing must not strand the other two, and every failure is reported —
 * never thrown — so a shutdown problem here can never replace the walk's
 * real success or failure.
 */
async function shutdownAll(running: RunningProcesses): Promise<void> {
	const results = await Promise.allSettled([
		stopWranglerDev(running.wranglerDev.child),
		stopWranglerDev(running.ingestWranglerDev.child),
		running.stubServer.close(),
	]);
	for (const result of results) {
		if (result.status === "rejected") {
			logShutdownWarning(result.reason);
		}
	}
}

async function runPhases(ctx: WalkContext): Promise<void> {
	for (const phase of walkPhases) {
		try {
			await phase.run(ctx);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new WalkFailure(`[${phase.name}] ${message}`, { cause: error });
		}
	}
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

function logShutdownWarning(error: unknown): void {
	console.error(`walk: shutdown warning — ${error instanceof Error ? error.message : String(error)}`);
}

async function main(): Promise<void> {
	const port = parseWalkPort(process.env["WALK_PORT"]);
	const baseUrl = `http://127.0.0.1:${port}`;
	const ingestPort = port + 1;
	const ingestBaseUrl = `http://127.0.0.1:${ingestPort}`;
	const browserUrl = `http://localhost:${port}/?active_region_id=${ACTIVE_REGION_ID}&publication_date=${PUBLICATION_DATE}`;
	const [generationCron, ingestCron] = await Promise.all([
		readSingleWranglerCron(join(generationDir, "wrangler.jsonc")),
		readSingleWranglerCron(join(ingestDir, "wrangler.jsonc")),
	]);

	console.log("walk: building workspace");
	await runCommand("pnpm", ["typecheck"], repoRoot);
	await runCommand("pnpm", ["-r", "build"], repoRoot);

	console.log("walk: starting wrangler dev");
	await assertPortSilent(`${baseUrl}/api/edition`, port);
	await assertPortSilent(`${ingestBaseUrl}/poll`, ingestPort);

	// The persist dir is created here and removed in the finally immediately
	// below, so every throw from this point on — migrations, spawn,
	// readiness, phases — reaches the removal; no path can leak the dir.
	const persistDir = await mkdtemp(join(tmpdir(), "bc-news-walk-"));
	try {
		console.log(`walk: applying local D1 migrations (persist dir ${persistDir})`);
		await runCommand(
			"pnpm",
			["exec", "wrangler", "d1", "migrations", "apply", "bc-news-editions", "--local", "--persist-to", persistDir],
			generationDir,
		);

		console.log("walk: starting bitjita stub server");
		const stubServer = await startBitJitaStubServer();

		const wranglerDev = startWranglerDev(
			generationDir,
			port,
			walkGenerationWranglerDevArguments({ port, persistDir }),
		);
		const ingestWranglerDev = startWranglerDev(
			ingestDir,
			ingestPort,
			wranglerDevArguments({
				port: ingestPort,
				persistDir,
				vars: { BITJITA_API_BASE: stubServer.baseUrl },
			}),
		);
		const running: RunningProcesses = { wranglerDev, ingestWranglerDev, stubServer };
		process.on("SIGINT", () => {
			if (interactiveHoldRelease === undefined) {
				void shutdownAll(running)
					.then(() => rm(persistDir, { recursive: true, force: true }))
					.finally(() => process.exit(130));
			}
		});
		try {
			await waitForReadiness(wranglerDev, `${baseUrl}/api/edition`, 400);
			await waitForReadiness(ingestWranglerDev, `${ingestBaseUrl}/poll`, 404);
			const pair: GenerationRunParams = {
				active_region_id: ACTIVE_REGION_ID,
				publication_date: PUBLICATION_DATE,
			};
			const unpublishedPair: GenerationRunParams = {
				active_region_id: ACTIVE_REGION_ID,
				publication_date: UNPUBLISHED_PUBLICATION_DATE,
			};
			const ctx: WalkContext = {
				baseUrl,
				ingestBaseUrl,
				generationDir,
				persistDir,
				scheduledTime: SCHEDULED_TIME,
				generationCron,
				ingestCron,
				pair,
				unpublishedPair,
				state: {},
			};
			await runPhases(ctx);
			console.log("WALK PASS");
			console.log(browserUrl);
			if (!nonInteractive) {
				await holdForHumanObservation();
			}
		} finally {
			// Shutdown problems are reported, never thrown: a kill-related
			// error here must not replace the walk's real success or failure.
			await shutdownAll(running);
		}
	} finally {
		await rm(persistDir, { recursive: true, force: true });
	}
}

main().catch((error: unknown) => {
	console.error(`WALK FAIL: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
