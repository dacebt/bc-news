import { createHash } from "node:crypto";
import { canonical } from "./evaluation-artifact-schemas";
import type { V7BenchmarkRun, V8BenchmarkRun } from "./evaluation-artifact";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import type { AnyLoadedEvaluationReferenceCorpus } from "./evaluation-reference-corpus";

export type JsonObject = Record<string, unknown>;
export type ControlledCorpusEntry = AnyLoadedEvaluationReferenceCorpus["entries"][number];
export type ControlledRun = {
	readonly run: V7BenchmarkRun | V8BenchmarkRun;
	readonly path: string;
	readonly entry: ControlledCorpusEntry;
};

export function json(value: object): string { return `${JSON.stringify(value, null, 2)}\n`; }
export function assertProof(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function gatewayRequestSha256(gatewayRequest: V8BenchmarkRun["gateway_requests"][number]): string {
	return hash(JSON.stringify(canonical(gatewayRequest)));
}

export function gatewayRequestSha256s(run: V8BenchmarkRun): string[] {
	return run.gateway_requests.map((gatewayRequest) => gatewayRequestSha256(gatewayRequest));
}

export function gatewayRequestHashesForStep(
	run: V8BenchmarkRun,
	step: ProductionModelStep,
): Array<{ run_id: string; trial_id: string; invocation_id: string; gateway_request_sha256: string }> {
	return run.trials.flatMap((trial) => trial.invocations
		.filter((invocation) => invocation.production_step === step)
		.map((invocation) => {
			const gatewayRequest = run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
			assertProof(gatewayRequest !== undefined, `Controlled invocation ${invocation.id} lacks Gateway-request evidence`);
			return { run_id: run.id, trial_id: trial.id, invocation_id: invocation.id, gateway_request_sha256: gatewayRequestSha256(gatewayRequest) };
		}));
}

export function verifierConfiguration(gateway: boolean): JsonObject {
	return {
		configurations: [{ production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			...(gateway ? {
				adapter: "cloudflare_ai_gateway",
				gateway: { selection: "named", id: "controlled-scorecard" },
				model: "openai/gpt-4o-mini",
			} : {
				adapter: "openai_compatible_hosted",
				provider: "repository_loopback",
				model: `scorecard/${step}`,
				billing: {
					method: "calculated",
					input_usd_per_million_tokens: 0,
					output_usd_per_million_tokens: 0,
					pricing_reference: "repository scorecard proof",
				},
			}),
		}])) }],
		repetition_count: 1,
		transport_retry_limit: 0,
	};
}

function claimTemplate(entry: ControlledCorpusEntry): {
	proposition: string;
	referenceId: string;
	relation: "supports" | "supports_status_qualified" | "unresolved";
	grounding: "grounded" | "indeterminate";
	body: string;
} {
	const statusRecord = entry.reference.claims[0] ?? entry.reference.events[0];
	if (statusRecord !== undefined) {
		const kind = entry.reference.claims[0] === statusRecord ? "claim" : "event";
		if (statusRecord.status === "established") return { proposition: statusRecord.supporting_witnesses[0]!.excerpt, referenceId: `${kind}:${statusRecord.id}`, relation: "supports", grounding: "grounded", body: `Source record states: ${statusRecord.supporting_witnesses[0]!.excerpt}` };
		if (statusRecord.status === "contested") return { proposition: `${statusRecord.supporting_witnesses[0]!.excerpt} ${statusRecord.opposing_witnesses[0]!.excerpt}`, referenceId: `${kind}:${statusRecord.id}`, relation: "supports_status_qualified", grounding: "grounded", body: `Source accounts are contested: ${statusRecord.supporting_witnesses[0]!.excerpt} ${statusRecord.opposing_witnesses[0]!.excerpt}` };
		return { proposition: statusRecord.unresolved_witnesses[0]!.excerpt, referenceId: `${kind}:${statusRecord.id}`, relation: "unresolved", grounding: "indeterminate", body: `Source accounts leave this unresolved: ${statusRecord.unresolved_witnesses[0]!.excerpt}` };
	}
	const ambiguity = entry.reference.ambiguities[0];
	if (ambiguity !== undefined) return { proposition: ambiguity.witnesses[0]!.excerpt, referenceId: `ambiguity:${ambiguity.id}`, relation: "unresolved", grounding: "indeterminate", body: `Source accounts leave this unresolved: ${ambiguity.witnesses[0]!.excerpt}` };
	const noteworthy = entry.reference.noteworthy_candidates[0]!;
	return { proposition: noteworthy.witnesses[0]!.excerpt, referenceId: `noteworthy:${noteworthy.id}`, relation: "supports", grounding: "grounded", body: `Source record notes: ${noteworthy.witnesses[0]!.excerpt}` };
}

export function controlledOutputs(entry: ControlledCorpusEntry): Record<ProductionModelStep, string> {
	const sourceClaim = claimTemplate(entry);
	const story = { title: "Regional Notes", subtitle: "Source record", main_story: { headline: "Source record", lede: "Codex-reviewed source evidence.", body: sourceClaim.body } };
	const noteworthy = entry.reference.noteworthy_candidates[0];
	const announcements = noteworthy === undefined ? [] : [{ title: "Regional notice", summary: noteworthy.witnesses[0]!.excerpt }];
	return {
		main_story_write: JSON.stringify(story),
		main_story_copyedit: JSON.stringify(story),
		announcements_write: JSON.stringify({ announcements }),
		announcements_copyedit: JSON.stringify({ announcements: announcements.map((announcement, index) => ({ id: `announcement-${String(index + 1)}`, ...announcement })) }),
	};
}

function outputIdentity(run: V7BenchmarkRun | V8BenchmarkRun, entry: ControlledCorpusEntry, invocation: V7BenchmarkRun["trials"][number]["invocations"][number], manifestId: string): JsonObject {
	assertProof(invocation.transport === "succeeded" && invocation.parse.state === "succeeded", "Controlled invocation did not parse successfully");
	assertProof(invocation.completion.text !== null, "Controlled parsed invocation has no textual completion");
	const runtime = run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
	assertProof(runtime?.state === "captured", `Controlled invocation ${invocation.id} lacks runtime evidence`);
	const trial = run.trials.find(({ id }) => id === runtime.trial_id)!;
	const identity = {
		benchmark_run_id: run.id,
		benchmark_run_version: run.version,
		code_commit_sha: run.provenance.code.commit_sha,
		prepared_evidence_identity_sha256: run.prepared_evidence.identity_sha256,
		corpus_manifest_id: manifestId,
		corpus_fixture_id: entry.manifestEntry.id,
		config_identity: invocation.config_identity,
		trial_id: trial.id,
		repetition: trial.repetition,
		invocation_id: invocation.id,
		production_step: invocation.production_step,
		invocation_ordinal: invocation.ordinal,
		request_sha256: invocation.request_sha256,
		completion_text_sha256: hash(invocation.completion.text),
		parsed_output_sha256: hash(JSON.stringify(canonical(invocation.parse.output))),
		runtime_evidence_sha256: hash(JSON.stringify(canonical(runtime.evidence))),
	};
	if (run.version === 7) return identity;
	const gatewayRequest = run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
	assertProof(gatewayRequest !== undefined, `Controlled invocation ${invocation.id} lacks Gateway-request evidence`);
	return { ...identity, gateway_request_sha256: gatewayRequestSha256(gatewayRequest) };
}

function span(pointer: string, excerpt: string): JsonObject { return { json_pointer: pointer, start_utf16: 0, end_utf16: excerpt.length, excerpt }; }

function annotation(entry: ControlledCorpusEntry, output: JsonObject, step: ProductionModelStep, ordinal: number): JsonObject {
	const sourceClaim = claimTemplate(entry); const storyRole = step.startsWith("main_story"); const noteworthy = entry.reference.noteworthy_candidates[0];
	const excerpt = storyRole ? sourceClaim.body : noteworthy?.witnesses[0]?.excerpt;
	const claim = excerpt === undefined ? [] : [{ id: `observed-claim-${String(ordinal)}`, proposition: storyRole ? sourceClaim.proposition : excerpt, atomic_proposition: true, spans: [span(storyRole ? "/main_story/body" : "/announcements/0/summary", excerpt)], references: [{ reference_id: storyRole ? sourceClaim.referenceId : `noteworthy:${noteworthy!.id}`, relation: storyRole ? sourceClaim.relation : "supports" }], grounding: storyRole ? sourceClaim.grounding : "grounded", attribution_requirement: storyRole ? "required" : "not_required", attribution: storyRole ? "present" : "not_applicable", rationale: "Codex bound the exact output span to the cited fixture reference.", uncertainty: "low" }];
	return {
		annotation_id: `annotation-${entry.manifestEntry.id}-${step}`, output, factual_claim_inventory_complete: true, factual_claims: claim,
		event_coverage: entry.reference.events.map((event) => storyRole && sourceClaim.referenceId === `event:${event.id}` ? { event_id: event.id, assessment: "covered", spans: [span("/main_story/body", sourceClaim.body)], rationale: "The exact story span communicates this source event.", uncertainty: "low" } : { event_id: event.id, assessment: "not_covered", spans: [], rationale: "This controlled output does not cover the source event.", uncertainty: "low" }),
		announcement_relevance: storyRole ? { state: "not_applicable" } : noteworthy === undefined ? { state: "assessed", announcements: [] } : { state: "assessed", announcements: [{ announcement_index: 0, assessment: "relevant", noteworthy_reference_ids: [`noteworthy:${noteworthy.id}`], rationale: "The exact summary communicates the cited candidate.", uncertainty: "low" }] },
	};
}

function review(entry: ControlledCorpusEntry, output: JsonObject): JsonObject {
	return { review_id: `review-${entry.manifestEntry.id}-${output.production_step as string}`, output, criteria: ["coherence", "usefulness", "newsworthiness", "voice"].map((criterion) => ({ criterion, assessment: "meets", rationale: `Codex assessed ${criterion} against rubric version 2.`, uncertainty: "low" })) };
}

export function buildControlledArtifacts(runs: readonly ControlledRun[], manifestId: string): {
	readonly createdAt: string;
	readonly annotations: JsonObject;
	readonly reviews: JsonObject;
} {
	const latestCompletion = Math.max(...runs.map(({ run }) => Date.parse(run.completed_at!)));
	const annotatedAt = new Date(latestCompletion + 1).toISOString();
	const reviewedAt = new Date(latestCompletion + 2).toISOString();
	const createdAt = new Date(latestCompletion + 3).toISOString();
	const outputs = runs.flatMap(({ run, entry }) => run.trials.flatMap(({ invocations }) => invocations.filter((invocation) => invocation.transport === "succeeded" && invocation.parse.state === "succeeded").map((invocation) => ({ entry, step: invocation.production_step, identity: outputIdentity(run, entry, invocation, manifestId) }))));
	return {
		createdAt,
		annotations: { version: 2, id: "annotations-controlled", protocol: { id: "bc-news-output-annotation", version: 2 }, annotator: { id: "codex", kind: "codex" }, annotated_at: annotatedAt, outputs: outputs.map(({ entry, identity, step }, index) => annotation(entry, identity, step, index + 1)) },
		reviews: { version: 2, id: "reviews-controlled", rubric: { id: "bc-news-editorial-qualitative", version: 2 }, reviewer: { id: "codex", kind: "codex" }, reviewed_at: reviewedAt, reviews: outputs.map(({ entry, identity }) => review(entry, identity)) },
	};
}
