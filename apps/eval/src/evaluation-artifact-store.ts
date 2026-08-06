import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { BenchmarkRunSchema, type BenchmarkRun } from "./evaluation-artifact";
import { validateBenchmarkRunTransition } from "./evaluation-artifact-transition";

export type EvaluationArtifactObserver = (artifact: BenchmarkRun) => void | Promise<void>;

export interface EvaluationArtifactReplaceOperations {
	readonly writeFile: typeof writeFile;
	readonly rename: typeof rename;
	readonly unlink: typeof unlink;
}

const DEFAULT_REPLACE_OPERATIONS: EvaluationArtifactReplaceOperations = { writeFile, rename, unlink };

export class EvaluationArtifactStoreError extends Error {
	readonly code: "create_rejected" | "write_rejected" | "read_rejected";
	readonly cleanup_failure: { readonly path: string; readonly cause: unknown } | undefined;

	constructor(
		code: EvaluationArtifactStoreError["code"],
		message: string,
		options?: ErrorOptions & { readonly cleanupFailure?: { readonly path: string; readonly cause: unknown } },
	) {
		super(message, options);
		this.name = "EvaluationArtifactStoreError";
		this.code = code;
		this.cleanup_failure = options?.cleanupFailure;
	}
}

function validated(artifact: BenchmarkRun, code: "create_rejected" | "write_rejected"): BenchmarkRun {
	const parsed = BenchmarkRunSchema.safeParse(artifact);
	if (!parsed.success) throw new EvaluationArtifactStoreError(code, parsed.error.message);
	return parsed.data;
}

async function parseSaved(path: string): Promise<BenchmarkRun> {
	let candidate: unknown;
	try {
		candidate = JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (cause) {
		throw new EvaluationArtifactStoreError("read_rejected", `Evaluation artifact at ${path} is not valid JSON`, { cause });
	}
	const parsed = BenchmarkRunSchema.safeParse(candidate);
	if (!parsed.success) throw new EvaluationArtifactStoreError("read_rejected", parsed.error.message);
	return parsed.data;
}

export class EvaluationArtifactStore {
	readonly path: string;
	readonly #observer: EvaluationArtifactObserver | undefined;
	readonly #replaceOperations: EvaluationArtifactReplaceOperations;

	private constructor(path: string, observer?: EvaluationArtifactObserver, replaceOperations = DEFAULT_REPLACE_OPERATIONS) {
		this.path = path;
		this.#observer = observer;
		this.#replaceOperations = replaceOperations;
	}

	static async create(path: string, artifact: BenchmarkRun, observer?: EvaluationArtifactObserver, replaceOperations?: EvaluationArtifactReplaceOperations): Promise<EvaluationArtifactStore> {
		const candidate = validated(artifact, "create_rejected");
		try {
			await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
		} catch (cause) {
			throw new EvaluationArtifactStoreError("create_rejected", `Could not exclusively create evaluation artifact at ${path}`, { cause });
		}
		const store = new EvaluationArtifactStore(path, observer, replaceOperations);
		const saved = await parseSaved(path);
		await observer?.(saved);
		return store;
	}

	async replace(artifact: BenchmarkRun): Promise<void> {
		const candidate = validated(artifact, "write_rejected");
		const current = await parseSaved(this.path);
		try {
			validateBenchmarkRunTransition(current, candidate);
		} catch (cause) {
			throw new EvaluationArtifactStoreError("write_rejected", `Rejected non-monotonic evaluation artifact transition at ${this.path}`, { cause });
		}
		const temporaryPath = join(dirname(this.path), `.${basename(this.path)}.${randomUUID()}.tmp`);
		let saved: BenchmarkRun;
		try {
			await this.#replaceOperations.writeFile(temporaryPath, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
			await parseSaved(temporaryPath);
			await this.#replaceOperations.rename(temporaryPath, this.path);
			saved = await parseSaved(this.path);
		} catch (cause) {
			let cleanupFailure: { readonly path: string; readonly cause: unknown } | undefined;
			try { await this.#replaceOperations.unlink(temporaryPath); }
			catch (unlinkCause: unknown) { cleanupFailure = { path: temporaryPath, cause: unlinkCause }; }
			const cleanupDetail = cleanupFailure === undefined ? "" : `; temporary artifact cleanup also failed at ${temporaryPath}`;
			throw new EvaluationArtifactStoreError("write_rejected", `Could not atomically replace evaluation artifact at ${this.path}${cleanupDetail}`, {
				cause,
				...(cleanupFailure === undefined ? {} : { cleanupFailure }),
			});
		}
		await this.#observer?.(saved);
	}

	read(): Promise<BenchmarkRun> {
		return parseSaved(this.path);
	}
}
