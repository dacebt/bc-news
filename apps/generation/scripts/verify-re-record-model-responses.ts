import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RecordedModelResponseSchema, type RecordedModelResponse } from "@bc-news/fixtures";
import { RunFileSchema } from "../../eval/src/run-file";
import { modelResponseBackupPath, modelResponseFileNames } from "./model-response-directory";

const SENTINEL_API_KEY = "verify-sentinel-api-key-never-retain";
const CompletionRequestSchema = z.strictObject({
	model: z.string().min(1),
	messages: z.tuple([
		z.strictObject({ role: z.literal("system"), content: z.string().min(1) }),
		z.strictObject({ role: z.literal("user"), content: z.string().min(1) }),
	]),
});
type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

interface ObservedRequest {
	readonly authorization: string | undefined;
	readonly path: string | undefined;
	readonly body: CompletionRequest;
}

const MODEL_BY_CAPABILITY = {
	announcements: "verify-announcements",
	main_story: "verify-main-story",
	packaging: "verify-packaging",
} as const;

const TEXT_BY_MODEL: Readonly<Record<string, string>> = {
	"verify-announcements": JSON.stringify({ announcements: [{ title: "Loopback milestone", summary: "**Verifier** recorded an announcement through the hosted provider." }] }),
	"verify-main-story": JSON.stringify({ main_story: { headline: "Loopback provider records the regional edition", lede: "The verification path exercised the production model port.", body: "**Verifier** observed the hosted OpenAI-compatible boundary end to end." } }),
	"verify-packaging": JSON.stringify({ title: "The Loopback Gazette", subtitle: "January 25, 2026" }),
};

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function requestBody(request: IncomingMessage): Promise<CompletionRequest> {
	const chunks: Buffer[] = [];
	for await (const chunk of request as AsyncIterable<unknown>) {
		if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
			throw new Error("Loopback verifier received an unsupported request-body chunk");
		}
		chunks.push(Buffer.from(chunk));
	}
	return CompletionRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
}

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("Loopback server has no TCP address");
	return address.port;
}

async function close(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

async function spawnTsx(input: {
	readonly repositoryRoot: string;
	readonly entrypoint: string;
	readonly args: readonly string[];
	readonly environment: Readonly<Record<string, string>>;
}): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = spawn(path.join(input.repositoryRoot, "node_modules/.bin/tsx"), [input.entrypoint, ...input.args], {
		cwd: input.repositoryRoot,
		env: { ...process.env, ...input.environment },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
	const code = await new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (exitCode) => resolve(exitCode ?? 1));
	});
	return { code, stdout, stderr };
}

function hostedConfig(model: string) {
	return {
		adapter: "openai_compatible_hosted",
		provider: "verify-hosted",
		model,
		billing: {
			method: "calculated",
			input_usd_per_million_tokens: 2,
			output_usd_per_million_tokens: 8,
			pricing_reference: "verify-prices-2026-08-04",
		},
	};
}

function judgeText(system: string): string {
	if (system.includes('"main_story"')) return JSON.stringify({ scores: { grounding: 5, voice: 4, structure: 4 }, reasoning: "Loopback judge verified the main story." });
	if (system.includes('"announcements"')) return JSON.stringify({ scores: { completeness: 5, accuracy: 5, clarity: 4, coverage_quality: 4 }, reasoning: "Loopback judge verified announcements." });
	if (system.includes('"packaging"')) return JSON.stringify({ scores: { preservation: 5, accuracy: 5, packaging: 4, metadata: 5 }, reasoning: "Loopback judge verified packaging." });
	throw new Error("Loopback judge could not identify capability");
}

function responseText(body: CompletionRequest): string {
	return body.model === "verify-judge" ? judgeText(body.messages[0].content) : TEXT_BY_MODEL[body.model] ?? "";
}

async function readRecords(outputDirectory: string) {
	const read = async (capability: keyof typeof MODEL_BY_CAPABILITY): Promise<RecordedModelResponse> => {
		const raw = await readFile(path.join(outputDirectory, `${capability}.json`), "utf8");
		return RecordedModelResponseSchema.parse(JSON.parse(raw) as unknown);
	};
	return { announcements: await read("announcements"), main_story: await read("main_story"), packaging: await read("packaging") };
}

function assertSecretAbsent(secret: string, surfaces: readonly string[]): void {
	for (const surface of surfaces) assert(!surface.includes(secret), "Sentinel API key escaped Authorization");
}

async function main(): Promise<void> {
	const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
	const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "bc-news-model-provider-"));
	const outputDirectory = path.join(temporaryParent, "model-responses");
	const evalResultsDirectory = path.join(temporaryParent, "eval-results");
	const evalConfigPath = path.join(temporaryParent, "eval.config.json");
	const observed: ObservedRequest[] = [];
	let announcementFailuresRemaining = 2;
	let rejectPackaging = false;
	const server = createServer((request, response) => {
		void (async () => {
			const body = await requestBody(request);
			observed.push({ authorization: request.headers.authorization, path: request.url, body });
			if (body.model === MODEL_BY_CAPABILITY.announcements && announcementFailuresRemaining > 0) {
				announcementFailuresRemaining -= 1;
				response.writeHead(503, { "Content-Type": "application/json" }).end("{}");
				return;
			}
			if (rejectPackaging && body.model === MODEL_BY_CAPABILITY.packaging) {
				response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ secret_echo: SENTINEL_API_KEY }));
				return;
			}
			const text = responseText(body);
			assert(text !== "", `Unexpected model requested: ${body.model}`);
			response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
				model: `returned/${body.model}`,
				choices: [{ message: { content: text } }],
				usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
			}));
		})().catch(() => response.writeHead(500, { "Content-Type": "application/json" }).end("{}"));
	});

	try {
		const port = await listen(server);
		const baseUrl = `http://127.0.0.1:${port}/v1`;
		const environment = {
			HOSTED_MODEL_BASE_URL: baseUrl,
			HOSTED_MODEL_API_KEY: SENTINEL_API_KEY,
		};
		const generationConfig = JSON.stringify({
			announcements: hostedConfig(MODEL_BY_CAPABILITY.announcements),
			main_story: hostedConfig(MODEL_BY_CAPABILITY.main_story),
			packaging: hostedConfig(MODEL_BY_CAPABILITY.packaging),
		});
		const reRecordEntrypoint = path.join(repositoryRoot, "apps/generation/scripts/re-record-model-responses.ts");
		const success = await spawnTsx({ repositoryRoot, entrypoint: reRecordEntrypoint, args: ["--output-dir", outputDirectory], environment: { ...environment, MODEL_CONFIG: generationConfig } });
		assert(success.code === 0, `Hosted re-record failed: ${success.stderr}`);
		assert((await modelResponseFileNames(outputDirectory)).length === 3, "Hosted re-record did not atomically promote three files");
		assert(observed.length === 5, "Hosted re-record did not enforce the three-attempt ceiling");
		for (const request of observed) {
			assert(request.authorization === `Bearer ${SENTINEL_API_KEY}`, "Hosted Authorization is incorrect");
			assert(request.path === "/v1/chat/completions", "Hosted endpoint lost its base path");
			assert(!JSON.stringify(request.body).includes(SENTINEL_API_KEY), "API key entered a request body");
		}
		const records = await readRecords(outputDirectory);
		for (const capability of Object.keys(records) as Array<keyof typeof records>) {
			const request = observed.find((entry) => entry.body.model === MODEL_BY_CAPABILITY[capability]);
			assert(request !== undefined, `Missing ${capability} request`);
			const expected = createHash("sha256").update(JSON.stringify({ system: request.body.messages[0].content, user: request.body.messages[1].content })).digest("hex");
			assert(records[capability].prompt_sha256 === expected, `Prompt hash mismatch for ${capability}`);
		}

		await writeFile(evalConfigPath, `${JSON.stringify({
			capabilities: {
				main_story: hostedConfig(MODEL_BY_CAPABILITY.main_story),
				announcements: hostedConfig(MODEL_BY_CAPABILITY.announcements),
				packaging: hostedConfig(MODEL_BY_CAPABILITY.packaging),
			},
			judge: hostedConfig("verify-judge"),
		}, null, 2)}\n`, "utf8");
		const beforeEval = observed.length;
		const evalResult = await spawnTsx({
			repositoryRoot,
			entrypoint: path.join(repositoryRoot, "apps/eval/src/cli.ts"),
			args: ["run", "--fixture", path.join(repositoryRoot, "packages/fixtures/evidence/active-region-7_2026-01-24.json"), "--config", evalConfigPath, "--results-dir", evalResultsDirectory],
			environment: { ...environment, INIT_CWD: repositoryRoot },
		});
		assert(evalResult.code === 0, `Hosted eval failed: ${evalResult.stderr}`);
		assert(observed.length - beforeEval === 6, "Fully judged eval did not make three capability and three judge calls");
		const [runFileName] = await readdir(evalResultsDirectory);
		assert(runFileName !== undefined, "Hosted eval saved no run file");
		const runBytes = await readFile(path.join(evalResultsDirectory, runFileName), "utf8");
		const run = RunFileSchema.parse(JSON.parse(runBytes) as unknown);
		const usages = run.steps.flatMap((step) => [step.model_usage, step.judge?.model_usage]);
		assert(usages.length === 6 && usages.every((usage) => usage?.execution === "hosted_inference"), "Hosted eval did not round-trip six usage records");
		assert(usages.reduce((total, usage) => total + (usage?.external_billing.classification === "calculated" ? usage.external_billing.amount_usd : 0), 0) === 0.00216, "Hosted eval total cost is incorrect");

		const originalFiles = new Map<string, string>();
		for (const fileName of await modelResponseFileNames(outputDirectory)) originalFiles.set(fileName, await readFile(path.join(outputDirectory, fileName), "utf8"));
		await rename(outputDirectory, modelResponseBackupPath(outputDirectory));
		rejectPackaging = true;
		const beforeFailure = observed.length;
		const failure = await spawnTsx({ repositoryRoot, entrypoint: reRecordEntrypoint, args: ["--output-dir", outputDirectory], environment: { ...environment, MODEL_CONFIG: generationConfig } });
		assert(failure.code !== 0, "Deterministic hosted response rejection unexpectedly promoted");
		assert(observed.length - beforeFailure === 3, "Deterministic hosted response rejection retried");
		for (const [fileName, original] of originalFiles) assert(await readFile(path.join(outputDirectory, fileName), "utf8") === original, `Failed hosted re-record changed ${fileName}`);
		assertSecretAbsent(SENTINEL_API_KEY, [success.stdout, success.stderr, evalResult.stdout, evalResult.stderr, failure.stdout, failure.stderr, runBytes, JSON.stringify(run.fingerprint), ...originalFiles.values()]);
		console.log("RE-RECORD VERIFY PASS: hosted atomic recording, bounded retry, deterministic rejection, six eval usages, exact cost, credential containment");
	} finally {
		await close(server);
		await rm(temporaryParent, { recursive: true, force: true });
	}
}

await main();
