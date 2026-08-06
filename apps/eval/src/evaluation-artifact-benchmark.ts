import { z } from "zod";
import {
	BenchmarkRunBaseSchema, canonicallyEqual, evaluationConfigIdentity, sha256Json,
} from "./evaluation-artifact-schemas";
import { refineTrial } from "./evaluation-artifact-trial-refinement";
import { V1PreparedEvidenceSchema, V1Sha256HashSchema, v1OutputContractProvenance } from "./evaluation-artifact-v1-contracts";

export const BenchmarkRunSchema = BenchmarkRunBaseSchema.extend({
	prepared_evidence: z.strictObject({
		identity_sha256: V1Sha256HashSchema,
		active_region_id: z.string().min(1),
		publication_date: z.iso.date(),
		original_count: z.number().int().nonnegative(),
		final_count: z.number().int().nonnegative(),
		snapshot: V1PreparedEvidenceSchema,
	}),
}).superRefine((run, context) => {
	const declaration = run.declaration.configurations[0];
	const roster = run.trial_roster[0];
	const trial = run.trials[0]!;
	if (declaration.identity !== evaluationConfigIdentity(declaration.config)) context.addIssue({ code: "custom", path: ["declaration", "configurations", 0, "identity"], message: "configuration identity must derive from its exact config" });
	if (roster.config_identity !== declaration.identity || trial.config_identity !== declaration.identity || roster.trial_id !== trial.id) context.addIssue({ code: "custom", path: ["trial_roster"], message: "declaration, roster, and trial identities must agree" });
	if (Date.parse(trial.started_at) < Date.parse(run.started_at)) context.addIssue({ code: "custom", path: ["trials", 0, "started_at"], message: "trial cannot start before its benchmark" });
	refineTrial(trial, run.prepared_evidence.snapshot, run.started_at, context);
	const evidence = run.prepared_evidence;
	if (evidence.identity_sha256 !== sha256Json(evidence.snapshot) || evidence.active_region_id !== evidence.snapshot.active_region_id || evidence.publication_date !== evidence.snapshot.publication_date || evidence.original_count !== evidence.snapshot.raw_count || evidence.final_count !== evidence.snapshot.final_count) context.addIssue({ code: "custom", path: ["prepared_evidence"], message: "prepared-evidence identity and summary must bind the exact frozen version 1 snapshot" });
	if (!canonicallyEqual(run.provenance.output_contracts, v1OutputContractProvenance())) context.addIssue({ code: "custom", path: ["provenance", "output_contracts"], message: "artifact version 1 requires the exact ordered frozen output-contract representations and hashes" });
	for (const [index, invocation] of trial.invocations.entries()) {
		const adapter = declaration.config.production_steps[invocation.production_step];
		if (invocation.transport !== "succeeded") continue;
		const expectedExecution = adapter.adapter === "lmstudio" ? "local_inference" : adapter.adapter === "recorded" ? "recorded_replay" : "hosted_inference";
		if (invocation.completion.execution !== expectedExecution || (adapter.adapter === "lmstudio" && invocation.completion.provider !== "lmstudio") || (adapter.adapter === "openai_compatible_hosted" && invocation.completion.provider !== adapter.provider)) context.addIssue({ code: "custom", path: ["trials", 0, "invocations", index, "completion"], message: "completion must match its declared step adapter execution and provider class" });
	}
	const countTotal = Object.values(run.outcome_counts).reduce((sum, count) => sum + count, 0);
	if (run.lifecycle === "running" && (run.completed_at !== null || run.harness_outcome !== "pending" || trial.lifecycle !== "running" || countTotal !== 0)) context.addIssue({ code: "custom", path: ["lifecycle"], message: "running benchmark requires a pending harness, running trial, null completion, and zero counts" });
	if (run.lifecycle === "complete") {
		if (run.completed_at === null || run.harness_outcome !== "retained" || trial.lifecycle !== "complete" || trial.subject_outcome === null || countTotal !== 1 || run.outcome_counts[trial.subject_outcome] !== 1) context.addIssue({ code: "custom", path: ["lifecycle"], message: "complete benchmark requires one-hot count for its retained terminal trial" });
		if (run.completed_at !== null && (Date.parse(run.completed_at) < Date.parse(run.started_at) || trial.completed_at === null || Date.parse(run.completed_at) < Date.parse(trial.completed_at))) context.addIssue({ code: "custom", path: ["completed_at"], message: "benchmark completion cannot precede benchmark start or trial completion" });
	}
});

export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;

export function evaluationOutputContractProvenance(): BenchmarkRun["provenance"]["output_contracts"] {
	return v1OutputContractProvenance() as BenchmarkRun["provenance"]["output_contracts"];
}
