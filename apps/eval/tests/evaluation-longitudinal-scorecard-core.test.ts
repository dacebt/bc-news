import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { buildEvaluationScorecard } from "../src/evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "../src/evaluation-scorecard-input";
import { createEvaluationScorecardArtifact } from "../src/evaluation-scorecard-store";
import { buildControlledEvaluationScorecardInput } from "../src/evaluation-scorecard-verifier";
import { V7BenchmarkRunSchema } from "../src/evaluation-artifact-v7";
import { buildEvaluationLongitudinalScorecard, projectLongitudinalRoleContext } from "../src/evaluation-longitudinal-scorecard-builder";
import { loadEvaluationLongitudinalInput } from "../src/evaluation-longitudinal-scorecard-input";
import {
	EVALUATION_LONGITUDINAL_ERROR_CODES, EvaluationLongitudinalDeclarationSchema,
	EvaluationLongitudinalScorecardArtifactSchema,
} from "../src/evaluation-longitudinal-scorecard";
import { createEvaluationLongitudinalScorecardArtifact, loadEvaluationLongitudinalScorecardArtifact } from "../src/evaluation-longitudinal-scorecard-store";

const roots = new Set<string>();
afterEach(async () => { await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true }))); roots.clear(); });
async function temporaryRoot(): Promise<string> { const root = await mkdtemp(join(tmpdir(), "bc-news-longitudinal-core-")); roots.add(root); return root; }
function hash(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
const CORPUS_MANIFEST = new URL("../../../packages/fixtures/evaluation-corpus/manifest.json", import.meta.url).pathname;

function declaration(scorecards: readonly object[]) { return { version: 1, id: "longitudinal-input", scorecards }; }
function descriptor(ordinal: number, phase: "baseline" | "subject", id: string, path = `scorecards/${id}.json`, scorecardSha256 = hash(id)) {
	return { ordinal, phase, path, scorecard_id: id, scorecard_sha256: scorecardSha256 };
}

test("keeps longitudinal contracts strict and the public error vocabulary closed", () => {
	expect(EVALUATION_LONGITUDINAL_ERROR_CODES).toEqual([
		"invalid_longitudinal_declaration_json", "longitudinal_declaration_rejected", "scorecard_source_unreadable",
		"scorecard_source_hash_mismatch", "scorecard_source_malformed", "scorecard_source_invalid",
		"scorecard_source_filename_mismatch", "longitudinal_evidence_set_mismatch", "longitudinal_chronology_mismatch",
		"cohort_projection_invalid", "series_artifact_tampered", "invalid_series_id", "series_not_found",
		"series_malformed", "series_invalid", "series_filename_mismatch", "series_create_rejected",
	]);
	const valid = declaration([descriptor(1, "baseline", "scorecard-one"), descriptor(2, "subject", "scorecard-two")]);
	expect(EvaluationLongitudinalDeclarationSchema.safeParse(valid).success).toBe(true);
	expect(EvaluationLongitudinalDeclarationSchema.safeParse({ ...valid, winner: "scorecard-one" }).success).toBe(false);
	expect(EvaluationLongitudinalScorecardArtifactSchema.safeParse({ version: 1, id: "series-one", overall_score: 1 }).success).toBe(false);
});

test("maps declaration, path, source-byte, and source-contract failures exactly", async () => {
	const root = await temporaryRoot(); await mkdir(join(root, "scorecards"));
	const declarationPath = join(root, "declaration.json");
	await writeFile(declarationPath, "{", "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "invalid_longitudinal_declaration_json" });
	await writeFile(declarationPath, JSON.stringify({ version: 1 }), "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "longitudinal_declaration_rejected" });
	await writeFile(declarationPath, JSON.stringify(declaration([descriptor(1, "subject", "scorecard-one"), descriptor(2, "baseline", "scorecard-two")])), "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "longitudinal_declaration_rejected" });
	for (const rejected of [
		declaration([descriptor(2, "baseline", "scorecard-one"), descriptor(3, "subject", "scorecard-two")]),
		declaration([descriptor(1, "baseline", "scorecard-one"), { ...descriptor(2, "subject", "scorecard-two"), scorecard_id: "scorecard-one" }]),
		declaration([descriptor(1, "baseline", "scorecard-one"), { ...descriptor(2, "subject", "scorecard-two"), path: "scorecards/scorecard-one.json" }]),
		declaration([descriptor(1, "baseline", "scorecard-one"), { ...descriptor(2, "subject", "scorecard-two"), scorecard_sha256: hash("scorecard-one") }]),
		declaration([descriptor(1, "baseline", "scorecard-one", "scorecards/./scorecard-one.json"), descriptor(2, "subject", "scorecard-two")]),
		declaration([descriptor(1, "baseline", "scorecard-one", join(root, "scorecard-one.json")), descriptor(2, "subject", "scorecard-two")]),
	]) {
		await writeFile(declarationPath, JSON.stringify(rejected), "utf8");
		await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "longitudinal_declaration_rejected" });
	}
	await writeFile(declarationPath, JSON.stringify(declaration([descriptor(1, "baseline", "scorecard-one", "../scorecard-one.json"), descriptor(2, "subject", "scorecard-two")])), "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "longitudinal_declaration_rejected" });
	await writeFile(declarationPath, JSON.stringify(declaration([descriptor(1, "baseline", "scorecard-one", "scorecards/not-scorecard-one.json"), descriptor(2, "subject", "scorecard-two")])), "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "scorecard_source_filename_mismatch" });
	await writeFile(declarationPath, JSON.stringify(declaration([descriptor(1, "baseline", "scorecard-one"), descriptor(2, "subject", "scorecard-two")])), "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "scorecard_source_unreadable" });
	await writeFile(join(root, "scorecards", "scorecard-one.json"), "{}", "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "scorecard_source_hash_mismatch" });
	await writeFile(declarationPath, JSON.stringify(declaration([descriptor(1, "baseline", "scorecard-one", undefined, hash("{")), descriptor(2, "subject", "scorecard-two")])), "utf8");
	await writeFile(join(root, "scorecards", "scorecard-one.json"), "{", "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "scorecard_source_malformed" });
	await writeFile(declarationPath, JSON.stringify(declaration([descriptor(1, "baseline", "scorecard-one", undefined, hash("{}")), descriptor(2, "subject", "scorecard-two")])), "utf8");
	await writeFile(join(root, "scorecards", "scorecard-one.json"), "{}", "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "scorecard_source_invalid" });
});

test("rejects a canonical source target that escapes the declaration root", async () => {
	const root = await temporaryRoot(); const declarationRoot = join(root, "declaration-root"); const sourceRoot = join(declarationRoot, "scorecards");
	await mkdir(sourceRoot, { recursive: true }); const external = join(root, "scorecard-one.json"); await writeFile(external, "{}", "utf8");
	await symlink(external, join(sourceRoot, "scorecard-one.json"));
	const declarationPath = join(declarationRoot, "declaration.json");
	await writeFile(declarationPath, JSON.stringify(declaration([descriptor(1, "baseline", "scorecard-one"), descriptor(2, "subject", "scorecard-two")])), "utf8");
	await expect(loadEvaluationLongitudinalInput(declarationPath)).rejects.toMatchObject({ code: "longitudinal_declaration_rejected" });
});

test("validates series ids before filesystem access and preserves stored-reader precedence", async () => {
	const root = await temporaryRoot();
	await expect(loadEvaluationLongitudinalScorecardArtifact("../escape", root)).rejects.toMatchObject({ code: "invalid_series_id", path: root });
	await expect(loadEvaluationLongitudinalScorecardArtifact("missing-series", root)).rejects.toMatchObject({ code: "series_not_found", path: join(root, "missing-series.json") });
	await writeFile(join(root, "malformed-series.json"), "{", "utf8");
	await expect(loadEvaluationLongitudinalScorecardArtifact("malformed-series", root)).rejects.toMatchObject({ code: "series_malformed" });
	await writeFile(join(root, "invalid-series.json"), "{}", "utf8");
	await expect(loadEvaluationLongitudinalScorecardArtifact("invalid-series", root)).rejects.toMatchObject({ code: "series_invalid" });
});

test("projects stable role context without generated locators and includes declared retry policy", async () => {
	const root = await temporaryRoot(); const controlled = await buildControlledEvaluationScorecardInput(join(root, "controlled"), CORPUS_MANIFEST);
	const loaded = await loadEvaluationScorecardInput(controlled.declarationPath);
	const scorecard = buildEvaluationScorecard(loaded, { id: "projection-source", createdAt: controlled.createdAt });
	const original = projectLongitudinalRoleContext(scorecard, "main_story_write");
	expect(original.state).toBe("identified");
	if (original.state !== "identified") throw new Error("Expected identified controlled role context");
	expect(original.projection.declared_transport_retry_limit).toBe(1);
	expect(original.projection.ordered_requests.every(({ observation_ordinal }, index) => observation_ordinal === index + 1)).toBe(true);
	const relocated = structuredClone(scorecard); relocated.id = "different-generated-scorecard"; relocated.created_at = new Date(Date.parse(scorecard.created_at) + 1).toISOString();
	expect(projectLongitudinalRoleContext(relocated, "main_story_write")).toEqual(original);
	const unknown = structuredClone(scorecard); unknown.scorecards[0]!.scorecard_context = { state: "unknown", reason: "no_captured_invocation" };
	expect(projectLongitudinalRoleContext(unknown, "main_story_write")).toEqual({ state: "unknown", reason: "no_captured_invocation" });
	const mixedRetry = structuredClone(scorecard); const embedded = mixedRetry.source_payloads.benchmark_runs[0]!;
	const run = V7BenchmarkRunSchema.parse(JSON.parse(Buffer.from(embedded.bytes_base64, "base64").toString("utf8")) as unknown);
	run.declaration.transport_retry_limit = 0; embedded.bytes_base64 = Buffer.from(`${JSON.stringify(run, null, 2)}\n`).toString("base64");
	expect(() => projectLongitudinalRoleContext(mixedRetry, "main_story_write")).toThrow(expect.objectContaining({ code: "cohort_projection_invalid" }));
}, 60_000);

test("builds, exclusively stores, reconstructs, and audits a complete comparable 3+2 series", async () => {
	const root = await temporaryRoot(); const scorecardDirectory = join(root, "scorecards"); await mkdir(scorecardDirectory);
	const descriptors: Array<ReturnType<typeof descriptor>> = []; let createdCursor = 0;
	for (let index = 0; index < 5; index += 1) {
		const controlled = await buildControlledEvaluationScorecardInput(join(root, `source-${String(index + 1)}`), CORPUS_MANIFEST);
		const input = await loadEvaluationScorecardInput(controlled.declarationPath);
		createdCursor = Math.max(createdCursor + 1, Date.parse(controlled.createdAt));
		const id = `longitudinal-source-${String(index + 1)}`;
		const artifact = buildEvaluationScorecard(input, { id, createdAt: new Date(createdCursor).toISOString() });
		const path = join(scorecardDirectory, `${id}.json`); await createEvaluationScorecardArtifact(path, artifact);
		const bytes = await readFile(path); descriptors.push(descriptor(index + 1, index < 3 ? "baseline" : "subject", id, `scorecards/${id}.json`, hash(bytes)));
	}
	const declarationPath = join(root, "declaration.json"); await writeFile(declarationPath, `${JSON.stringify(declaration(descriptors), null, 2)}\n`, "utf8");
	let loaded;
	try { loaded = await loadEvaluationLongitudinalInput(declarationPath); }
	catch (cause) { throw new Error("Controlled longitudinal declaration did not load", { cause }); }
	for (const step of ["main_story_write", "main_story_copyedit", "announcements_write", "announcements_copyedit"] as const) {
		const contexts = loaded.stableRoleContexts.map((entry) => entry[step]);
		expect(contexts.every(({ state }) => state === "identified")).toBe(true);
		expect(new Set(contexts.flatMap((context) => context.state === "identified" ? [context.identity] : [])).size).toBe(1);
	}
	let artifact;
	try { artifact = buildEvaluationLongitudinalScorecard(loaded, { id: "controlled-longitudinal-series", createdAt: new Date(createdCursor + 1).toISOString() }); }
	catch (cause) { throw new Error("Controlled longitudinal artifact did not build", { cause }); }
	expect(artifact.roles.map(({ production_step }) => production_step)).toEqual(["main_story_write", "main_story_copyedit", "announcements_write", "announcements_copyedit"]);
	expect(artifact.roles.every(({ classification }) => classification.state === "within_baseline" || classification.state === "potential_drift")).toBe(true);
	const insufficientPath = join(root, "insufficient-declaration.json");
	await writeFile(insufficientPath, `${JSON.stringify(declaration([
		{ ...descriptors[0]!, ordinal: 1, phase: "baseline" },
		{ ...descriptors[3]!, ordinal: 2, phase: "subject" },
	]), null, 2)}\n`, "utf8");
	const insufficient = buildEvaluationLongitudinalScorecard(await loadEvaluationLongitudinalInput(insufficientPath), { id: "insufficient-series", createdAt: new Date(createdCursor + 1).toISOString() });
	expect(insufficient.roles.every(({ classification }) => classification.state === "insufficient_evidence"
		&& classification.reasons.includes("baseline_below_minimum") && classification.reasons.includes("subject_below_minimum"))).toBe(true);
	const seriesPath = join(root, `${artifact.id}.json`); const created = await createEvaluationLongitudinalScorecardArtifact(seriesPath, artifact);
	expect(await loadEvaluationLongitudinalScorecardArtifact(artifact.id, root)).toEqual(created);
	await expect(createEvaluationLongitudinalScorecardArtifact(seriesPath, artifact)).rejects.toMatchObject({ code: "series_create_rejected" });
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, scorecards: loaded.scorecards.slice(1) }, { id: "sliced-series", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const reordered = [...loaded.scorecards]; [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, scorecards: reordered }, { id: "reordered-series", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const substituted = [...loaded.scorecards]; substituted[0] = substituted[1]!;
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, scorecards: substituted }, { id: "substituted-series", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const detached = loaded.scorecards.map((source, index) => index === 0 ? { ...source, bytes: Buffer.concat([source.bytes, Buffer.from(" ")]) } : source);
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, scorecards: detached }, { id: "detached-series", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const provenanceDetached = loaded.scorecards.map((source, index) => index === 0 ? { ...source, annotationProvenance: { ...source.annotationProvenance, reviewerId: "detached-reviewer" } } : source);
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, scorecards: provenanceDetached }, { id: "provenance-detached-series", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const parsedDetached = loaded.scorecards.map((source, index) => {
		if (index !== 0) return source;
		const detachedArtifact = structuredClone(source.artifact); detachedArtifact.scorecards[0]!.sample_counts.declared_trial_count! += 1;
		return { ...source, artifact: detachedArtifact };
	});
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, scorecards: parsedDetached }, { id: "parsed-detached-series", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const substitutedIdArtifact = structuredClone(loaded.scorecards[0]!.artifact); substitutedIdArtifact.id = "substituted-source-id";
	const substitutedIdBytes = Buffer.from(`${JSON.stringify(substitutedIdArtifact, null, 2)}\n`); const substitutedIdDescriptor = { ...loaded.declaration.scorecards[0]!, path: "scorecards/substituted-source-id.json", scorecard_id: "substituted-source-id", scorecard_sha256: hash(substitutedIdBytes) };
	const substitutedIdDeclaration = { ...loaded.declaration, scorecards: [substitutedIdDescriptor, ...loaded.declaration.scorecards.slice(1)] };
	const substitutedIdSource = { ...loaded.scorecards[0]!, descriptor: substitutedIdDescriptor, path: join(root, substitutedIdDescriptor.path), canonicalPath: join(root, substitutedIdDescriptor.path), bytes: substitutedIdBytes, artifact: substitutedIdArtifact };
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, declaration: substitutedIdDeclaration, declarationBytes: Buffer.from(`${JSON.stringify(substitutedIdDeclaration, null, 2)}\n`), scorecards: [substitutedIdSource, ...loaded.scorecards.slice(1)] }, { id: "id-substituted-series", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const derivedArtifact = structuredClone(loaded.scorecards[0]!.artifact); derivedArtifact.scorecards[0]!.sample_counts.declared_trial_count! += 1;
	const derivedBytes = Buffer.from(`${JSON.stringify(derivedArtifact, null, 2)}\n`); const derivedDescriptor = { ...loaded.declaration.scorecards[0]!, scorecard_sha256: hash(derivedBytes) };
	const derivedDeclaration = { ...loaded.declaration, scorecards: [derivedDescriptor, ...loaded.declaration.scorecards.slice(1)] };
	const derivedSource = { ...loaded.scorecards[0]!, descriptor: derivedDescriptor, bytes: derivedBytes, artifact: derivedArtifact };
	expect(() => buildEvaluationLongitudinalScorecard({ ...loaded, declaration: derivedDeclaration, declarationBytes: Buffer.from(`${JSON.stringify(derivedDeclaration, null, 2)}\n`), scorecards: [derivedSource, ...loaded.scorecards.slice(1)] }, { id: "coordinated-derived-tamper", createdAt: new Date(createdCursor + 1).toISOString() })).toThrow(expect.objectContaining({ code: "longitudinal_evidence_set_mismatch" }));
	const sentinel = join(root, "outside-reconstruction-sentinel.json"); const traversal = structuredClone(artifact);
	const embeddedDeclaration = JSON.parse(Buffer.from(traversal.source_payloads.declaration_base64, "base64").toString("utf8")) as { scorecards: Array<{ path: string }> };
	embeddedDeclaration.scorecards[0]!.path = sentinel; const traversalDeclarationBytes = Buffer.from(`${JSON.stringify(embeddedDeclaration, null, 2)}\n`);
	traversal.source_payloads.declaration_base64 = traversalDeclarationBytes.toString("base64"); traversal.declaration_sha256 = hash(traversalDeclarationBytes);
	const traversalDirectory = join(root, "traversal-artifact"); await mkdir(traversalDirectory); await writeFile(join(traversalDirectory, `${traversal.id}.json`), `${JSON.stringify(traversal, null, 2)}\n`, "utf8");
	await expect(loadEvaluationLongitudinalScorecardArtifact(traversal.id, traversalDirectory)).rejects.toMatchObject({ code: "series_artifact_tampered" });
	await expect(access(sentinel)).rejects.toBeDefined();
	const stored = JSON.parse(await readFile(seriesPath, "utf8")) as unknown;
	const parsed = EvaluationLongitudinalScorecardArtifactSchema.parse(stored); parsed.roles[0].phase_count_summaries.baseline.declared_trial_count! += 1;
	await writeFile(seriesPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
	await expect(loadEvaluationLongitudinalScorecardArtifact(artifact.id, root)).rejects.toMatchObject({ code: "series_artifact_tampered" });
	await writeFile(seriesPath, `${JSON.stringify({ ...artifact, source_payloads: { ...artifact.source_payloads, declaration_base64: "AB==" } }, null, 2)}\n`, "utf8");
	await expect(loadEvaluationLongitudinalScorecardArtifact(artifact.id, root)).rejects.toMatchObject({ code: "series_artifact_tampered" });
	await writeFile(seriesPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	await writeFile(join(root, "different-series.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	await expect(loadEvaluationLongitudinalScorecardArtifact("different-series", root)).rejects.toMatchObject({ code: "series_filename_mismatch" });
}, 120_000);
