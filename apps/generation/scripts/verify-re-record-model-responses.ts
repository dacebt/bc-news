import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { z } from "zod";
import { RecordedModelResponseSchema, type RecordedModelResponse } from "@bc-news/fixtures";
import { modelResponseBackupPath, modelResponseFileNames } from "./model-response-directory";

const CompletionRequestSchema = z.strictObject({
	model: z.string().min(1),
	messages: z.tuple([
		z.strictObject({ role: z.literal("system"), content: z.string().min(1) }),
		z.strictObject({ role: z.literal("user"), content: z.string().min(1) }),
	]),
});
type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

interface ObservedRequest {
	authorization: string | undefined;
	contentType: string | undefined;
	path: string | undefined;
	body: CompletionRequest;
}

const MODEL_BY_CAPABILITY = {
	announcements: "verify-announcements",
	main_story: "verify-main-story",
	packaging: "verify-packaging",
} as const;

const TEXT_BY_MODEL: Readonly<Record<string, string>> = {
	"verify-announcements": JSON.stringify({
		announcements: [
			{
				title: "Loopback milestone",
				summary: "**Verifier** recorded an announcement through the local provider.",
			},
		],
	}),
	"verify-main-story": JSON.stringify({
		main_story: {
			headline: "Loopback provider records the regional edition",
			lede: "The verification path exercised the production model port.",
			body: "**Verifier** observed the local OpenAI-compatible boundary end to end.",
		},
	}),
	"verify-packaging": JSON.stringify({
		title: "The Loopback Gazette",
		subtitle: "January 25, 2026",
	}),
};

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request as AsyncIterable<unknown>) {
		if (typeof chunk === "string" || chunk instanceof Uint8Array) {
			chunks.push(Buffer.from(chunk));
			continue;
		}
		throw new Error("Loopback verifier received an unsupported request-body chunk");
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("Loopback verifier did not receive a TCP address");
	}
	return address.port;
}

async function close(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
}

async function runCommand(input: {
	repositoryRoot: string;
	outputDirectory: string;
	baseUrl: string;
	modelConfig: string;
}): Promise<{ code: number; stderr: string; stdout: string }> {
	const executable = path.join(input.repositoryRoot, "node_modules/.bin/tsx");
	const entrypoint = path.join(
		input.repositoryRoot,
		"apps/generation/scripts/re-record-model-responses.ts",
	);
	const child = spawn(executable, [entrypoint, "--output-dir", input.outputDirectory], {
		cwd: input.repositoryRoot,
		env: {
			...process.env,
			LMSTUDIO_BASE_URL: input.baseUrl,
			MODEL_CONFIG: input.modelConfig,
		},
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
	return { code, stderr, stdout };
}

async function readRecordedResponses(
	outputDirectory: string,
): Promise<Record<keyof typeof MODEL_BY_CAPABILITY, RecordedModelResponse>> {
	const read = async (capability: keyof typeof MODEL_BY_CAPABILITY) => {
		const raw = await readFile(path.join(outputDirectory, `${capability}.json`), "utf8");
		return RecordedModelResponseSchema.parse(JSON.parse(raw) as unknown);
	};
	return {
		announcements: await read("announcements"),
		main_story: await read("main_story"),
		packaging: await read("packaging"),
	};
}

function expectedPromptHash(request: CompletionRequest): string {
	const system = request.messages[0].content;
	const user = request.messages[1].content;
	return createHash("sha256").update(JSON.stringify({ system, user }), "utf8").digest("hex");
}

async function main(): Promise<void> {
	const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
	const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "bc-news-model-responses-"));
	const outputDirectory = path.join(temporaryParent, "model-responses");
	const observedRequests: ObservedRequest[] = [];
	let announcementFailuresRemaining = 2;
	let rejectPackagingContract = false;
	const server = createServer((request, response) => {
		void (async () => {
			const body = CompletionRequestSchema.parse(await readRequestBody(request));
			observedRequests.push({
				authorization: request.headers.authorization,
				contentType: request.headers["content-type"],
				path: request.url,
				body,
			});
			if (
				body.model === MODEL_BY_CAPABILITY.announcements &&
				announcementFailuresRemaining > 0
			) {
				announcementFailuresRemaining -= 1;
				response.writeHead(503, { "Content-Type": "application/json" });
				response.end(JSON.stringify({ error: "transient verifier failure" }));
				return;
			}
			const text =
				rejectPackagingContract && body.model === MODEL_BY_CAPABILITY.packaging
					? "{}"
					: TEXT_BY_MODEL[body.model];
			assert(text !== undefined, `Unexpected model requested: ${body.model}`);
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
		})().catch((error: unknown) => {
			response.writeHead(500, { "Content-Type": "text/plain" });
			response.end(error instanceof Error ? error.message : String(error));
		});
	});

	try {
		const port = await listen(server);
		const modelConfig = JSON.stringify({
			announcements: { adapter: "lmstudio", model: MODEL_BY_CAPABILITY.announcements },
			main_story: { adapter: "lmstudio", model: MODEL_BY_CAPABILITY.main_story },
			packaging: { adapter: "lmstudio", model: MODEL_BY_CAPABILITY.packaging },
		});
		const commandInput = {
			repositoryRoot,
			outputDirectory,
			baseUrl: `http://127.0.0.1:${port}/v1`,
			modelConfig,
		};
		const success = await runCommand(commandInput);
		assert(success.code === 0, `Re-record command failed:\n${success.stderr}`);
		assert(
			(await modelResponseFileNames(outputDirectory)).join(",") ===
				"announcements.json,main_story.json,packaging.json",
			"Re-record command did not promote exactly three capability files",
		);
		assert(observedRequests.length === 5, "Standalone command did not bound retries at three attempts");
		for (const request of observedRequests) {
			assert(request.path === "/v1/chat/completions", "Provider request lost the base path prefix");
			assert(request.authorization === "Bearer lmstudio", "Provider request auth is incorrect");
			assert(request.contentType === "application/json", "Provider request content type is incorrect");
		}
		const packagingIndex = observedRequests.findIndex(
			(request) => request.body.model === MODEL_BY_CAPABILITY.packaging,
		);
		assert(packagingIndex === 4, "Packaging ran before announcements and main story validated");
		const packagingRequest = observedRequests[packagingIndex];
		assert(packagingRequest !== undefined, "Packaging request was not observed");
		const packagingPrompt = packagingRequest.body.messages[1].content;
		assert(packagingPrompt.includes("Loopback milestone"), "Packaging omitted validated announcements");
		assert(
			packagingPrompt.includes("Loopback provider records the regional edition"),
			"Packaging omitted the validated main story",
		);

		const records = await readRecordedResponses(outputDirectory);
		for (const capability of Object.keys(MODEL_BY_CAPABILITY) as Array<
			keyof typeof MODEL_BY_CAPABILITY
		>) {
			const request = observedRequests.find(
				(candidate) => candidate.body.model === MODEL_BY_CAPABILITY[capability],
			);
			assert(request !== undefined, `No provider request observed for ${capability}`);
			assert(records[capability].prompt_sha256 === expectedPromptHash(request.body), `Prompt hash mismatch for ${capability}`);
		}

		const originalFiles = new Map<string, string>();
		for (const fileName of await modelResponseFileNames(outputDirectory)) {
			originalFiles.set(fileName, await readFile(path.join(outputDirectory, fileName), "utf8"));
		}
		await rename(outputDirectory, modelResponseBackupPath(outputDirectory));
		rejectPackagingContract = true;
		const failure = await runCommand(commandInput);
		assert(failure.code !== 0, "Invalid packaging response unexpectedly promoted");
		for (const [fileName, original] of originalFiles) {
			assert(
				(await readFile(path.join(outputDirectory, fileName), "utf8")) === original,
				`Failed re-record left a mixed response set at ${fileName}`,
			);
		}
		console.log("RE-RECORD VERIFY PASS: bounded retry, 3 validated responses, canonical hashes, ordered packaging, atomic recovery");
	} finally {
		await close(server);
		await rm(temporaryParent, { recursive: true, force: true });
	}
}

await main();
