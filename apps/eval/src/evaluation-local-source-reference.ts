import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const SHA256 = /^[0-9a-f]{64}$/u;

function isContainedRelativePath(value: string): boolean {
	if (value.startsWith("/") || value.includes("\\")) return false;
	const segments = value.split("/");
	return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

const LocalSourcePathSchema = z.string().min(1).refine(isContainedRelativePath, "Path must be a contained POSIX local-data-relative path");
const LocalDirectoryPathSchema = z.string().refine((value) => value === "" || isContainedRelativePath(value), "Directory path must be empty or a contained POSIX local-data-relative path");

export const EvaluationLocalSourceReferenceSchema = z.strictObject({
	path: LocalSourcePathSchema,
	sha256: z.string().regex(SHA256),
});

export type EvaluationLocalSourceReference = z.infer<typeof EvaluationLocalSourceReferenceSchema>;

export class EvaluationLocalSourceError extends Error {
	readonly code: "root_unreadable" | "path_escape" | "source_unreadable" | "source_mismatch" | "symlink_rejected";
	readonly path: string;

	constructor(code: EvaluationLocalSourceError["code"], path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvaluationLocalSourceError";
		this.code = code;
		this.path = path;
	}
}

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function rejectPath(path: string, message: string, cause?: unknown): never {
	throw new EvaluationLocalSourceError("path_escape", path, message, cause === undefined ? undefined : { cause });
}

async function canonicalLocalDataRoot(localDataRoot: string): Promise<string> {
	const candidate = resolve(localDataRoot);
	try {
		const canonical = await realpath(candidate);
		const details = await stat(canonical);
		if (!details.isDirectory()) throw new Error("Local data root is not a directory");
		return canonical;
	} catch (cause) {
		throw new EvaluationLocalSourceError("root_unreadable", candidate, `Local data root is unreadable: ${candidate}`, { cause });
	}
}

function parseLocalSourcePath(path: string): string {
	const parsed = LocalSourcePathSchema.safeParse(path);
	if (!parsed.success) rejectPath(path, "Local source must be a contained POSIX local-data-relative path", parsed.error);
	return parsed.data;
}

function parseLocalDirectoryPath(path: string): string {
	const parsed = LocalDirectoryPathSchema.safeParse(path);
	if (!parsed.success) rejectPath(path, "Local source directory must stay inside local-data root", parsed.error);
	return parsed.data;
}

async function resolveContainedPath(root: string, relativePath: string, expected: "file" | "directory"): Promise<string> {
	const segments = relativePath.length === 0 ? [] : relativePath.split("/");
	let current = root;
	for (const [index, segment] of segments.entries()) {
		const next = join(current, segment);
		let details;
		try {
			details = await lstat(next);
		} catch (cause) {
			throw new EvaluationLocalSourceError("source_unreadable", relativePath, `Local source is missing or unreadable: ${relativePath}`, { cause });
		}
		if (details.isSymbolicLink()) throw new EvaluationLocalSourceError("symlink_rejected", relativePath, `Local source path contains a symlink: ${relativePath}`);
		const finalSegment = index === segments.length - 1;
		if (!finalSegment) {
			if (!details.isDirectory()) throw new EvaluationLocalSourceError("source_unreadable", relativePath, `Local source ancestor is not a directory: ${relativePath}`);
			current = next;
			continue;
		}
		if (expected === "file" && !details.isFile()) throw new EvaluationLocalSourceError("source_unreadable", relativePath, `Local source is not a regular file: ${relativePath}`);
		if (expected === "directory" && !details.isDirectory()) throw new EvaluationLocalSourceError("source_unreadable", relativePath, `Local source is not a directory: ${relativePath}`);
		current = next;
	}
	return current;
}

async function listContainedRegularFiles(root: string, directoryPath: string): Promise<readonly string[]> {
	const target = directoryPath.length === 0 ? root : await resolveContainedPath(root, directoryPath, "directory");
	const collected: string[] = [];
	const walk = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
		const entries = await readdir(absoluteDirectory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const childRelative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
			if (entry.isSymbolicLink()) throw new EvaluationLocalSourceError("symlink_rejected", childRelative, `Local source path contains a symlink: ${childRelative}`);
			if (entry.isDirectory()) {
				await walk(join(absoluteDirectory, entry.name), childRelative);
				continue;
			}
			if (!entry.isFile()) throw new EvaluationLocalSourceError("source_unreadable", childRelative, `Local source is not a regular file: ${childRelative}`);
			collected.push(childRelative);
		}
	};
	await walk(target, directoryPath);
	return collected;
}

export async function sourceReferenceForLocalFile(localDataRoot: string, sourcePath: string): Promise<EvaluationLocalSourceReference> {
	const root = await canonicalLocalDataRoot(localDataRoot);
	const path = parseLocalSourcePath(sourcePath);
	const bytes = await readFile(await resolveContainedPath(root, path, "file"));
	return { path, sha256: hash(bytes) };
}

export async function readEvaluationLocalSource(localDataRoot: string, reference: EvaluationLocalSourceReference): Promise<Uint8Array> {
	const parsed = EvaluationLocalSourceReferenceSchema.safeParse(reference);
	if (!parsed.success) rejectPath(String(reference.path), "Invalid local evaluation source reference", parsed.error);
	const root = await canonicalLocalDataRoot(localDataRoot);
	const bytes = await readFile(await resolveContainedPath(root, parsed.data.path, "file"));
	if (hash(bytes) !== parsed.data.sha256) throw new EvaluationLocalSourceError("source_mismatch", parsed.data.path, `Local source digest mismatch: ${parsed.data.path}`);
	return bytes;
}

export async function listEvaluationLocalSources(localDataRoot: string, directoryPath: string): Promise<readonly string[]> {
	const root = await canonicalLocalDataRoot(localDataRoot);
	const path = parseLocalDirectoryPath(directoryPath);
	return listContainedRegularFiles(root, path);
}
