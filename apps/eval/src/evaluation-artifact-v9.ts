import { z } from "zod";
import { ModelRuntimeEvidenceSchema, PreparedEvidenceSchema } from "@bc-news/generation-core";
import { ModelRequestProvenanceSchema } from "@bc-news/generation-core";
import {
	CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES,
	cloudflareAiGatewayProviderForModel,
} from "@bc-news/model-adapters";
import { EvalConfigSchema } from "./config";
import {
	CURRENT_OUTPUT_CONTRACT_NAMES,
	CURRENT_PRODUCTION_MODEL_STEPS,
	type CurrentProductionModelStep,
} from "./current-production-steps";
import {
	EvaluationCodeProvenanceSchema,
	EvaluationFindingSchema,
	EvaluationIdSchema,
	EvaluationTimestampSchema,
	OutputContractProvenanceSchema,
	Sha256HashSchema,
	StepInvocationSchema,
	canonicallyEqual,
	evaluationConfigIdentity,
	sha256Json,
} from "./evaluation-artifact-schemas";

const RuntimeEvidenceIdentitySchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	invocation_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	production_step: z.enum(CURRENT_PRODUCTION_MODEL_STEPS),
	ordinal: z.number().int().positive(),
});

const PendingRuntimeEvidenceSchema = z.strictObject({
	...RuntimeEvidenceIdentitySchema.shape,
	state: z.literal("pending"),
});

const UnavailableRuntimeEvidenceSchema = z.strictObject({
	...RuntimeEvidenceIdentitySchema.shape,
	state: z.literal("unavailable"),
	reason: z.enum(["transport_failed"]),
});

const CapturedRuntimeEvidenceSchema = z.strictObject({
	...RuntimeEvidenceIdentitySchema.shape,
	state: z.literal("captured"),
	evidence: ModelRuntimeEvidenceSchema,
});

export const RuntimeEvidenceRecordSchema = z.discriminatedUnion("state", [
	PendingRuntimeEvidenceSchema,
	UnavailableRuntimeEvidenceSchema,
	CapturedRuntimeEvidenceSchema,
]);

const GatewayRequestIdentitySchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	invocation_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	production_step: z.enum(CURRENT_PRODUCTION_MODEL_STEPS),
	ordinal: z.number().int().positive(),
});

const PendingGatewayRequestSchema = z.strictObject({
	...GatewayRequestIdentitySchema.shape,
	state: z.literal("pending"),
});

const UnavailableGatewayRequestSchema = z.strictObject({
	...GatewayRequestIdentitySchema.shape,
	state: z.literal("unavailable"),
	reason: z.literal("transport_failed"),
});

const NotApplicableGatewayRequestSchema = z.strictObject({
	...GatewayRequestIdentitySchema.shape,
	state: z.literal("not_applicable"),
});

const CapturedGatewayRequestSchema = z.strictObject({
	...GatewayRequestIdentitySchema.shape,
	state: z.literal("captured"),
	provenance: ModelRequestProvenanceSchema,
});

export const GatewayRequestRecordSchema = z.discriminatedUnion("state", [
	PendingGatewayRequestSchema,
	UnavailableGatewayRequestSchema,
	NotApplicableGatewayRequestSchema,
	CapturedGatewayRequestSchema,
]);

const TrackStateSchema = z.strictObject({
	lifecycle: z.enum(["pending", "running", "completed", "rejected"]),
	subject_outcome: z
		.enum([
			"completed",
			"parse_rejected",
			"contract_rejected",
			"infrastructure_incomplete",
		])
		.nullable(),
	terminal_production_step: z.enum(CURRENT_PRODUCTION_MODEL_STEPS).nullable(),
	product: z.record(z.string(), z.unknown()).nullable(),
	findings: z.array(EvaluationFindingSchema),
});

const EvaluationTrialSchema = z.strictObject({
	id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	repetition: z.number().int().positive(),
	lifecycle: z.enum(["running", "complete"]),
	started_at: EvaluationTimestampSchema,
	completed_at: EvaluationTimestampSchema.nullable(),
	subject_outcome: z
		.enum([
			"completed",
			"parse_rejected",
			"contract_rejected",
			"infrastructure_incomplete",
		])
		.nullable(),
	tracks: z.strictObject({
		main_story: TrackStateSchema,
		announcements: TrackStateSchema,
	}),
	selected_invocation_ids: z.strictObject({
		main_story_write: EvaluationIdSchema.nullable(),
		announcements_write: EvaluationIdSchema.nullable(),
	}),
	invocations: z.array(StepInvocationSchema),
});

const DeclaredConfigurationSchema = z.strictObject({
	identity: EvaluationIdSchema,
	config: EvalConfigSchema,
});

const TrialRosterMemberSchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	repetition: z.number().int().positive(),
});

export const V9BenchmarkRunBaseSchema = z.strictObject({
	version: z.literal(9),
	id: EvaluationIdSchema,
	lifecycle: z.enum(["running", "complete"]),
	started_at: EvaluationTimestampSchema,
	completed_at: EvaluationTimestampSchema.nullable(),
	declaration: z.strictObject({
		configurations: z.array(DeclaredConfigurationSchema).min(1),
		repetition_count: z.number().int().positive(),
		transport_retry_limit: z.number().int().min(0).max(3),
	}),
	fixture: z.strictObject({
		path: z.string().min(1),
		fixture_sha256: Sha256HashSchema,
	}),
	prepared_evidence: z.strictObject({
		identity_sha256: Sha256HashSchema,
		active_region_id: z.string().min(1),
		publication_date: z.iso.date(),
		original_count: z.number().int().nonnegative(),
		final_count: z.number().int().nonnegative(),
		snapshot: PreparedEvidenceSchema,
	}),
	provenance: z.strictObject({
		code: EvaluationCodeProvenanceSchema,
		output_contracts: z.tuple([
			OutputContractProvenanceSchema,
			OutputContractProvenanceSchema,
		]),
	}),
	trial_roster: z.array(TrialRosterMemberSchema).min(1),
	trials: z.array(EvaluationTrialSchema),
	runtime_evidence: z.array(RuntimeEvidenceRecordSchema),
	gateway_requests: z.array(GatewayRequestRecordSchema),
	outcome_counts: z.strictObject({
		completed: z.number().int().nonnegative(),
		parse_rejected: z.number().int().nonnegative(),
		contract_rejected: z.number().int().nonnegative(),
		infrastructure_incomplete: z.number().int().nonnegative(),
	}),
	harness_outcome: z.enum(["pending", "retained"]),
});

type V9BenchmarkRunCandidate = z.infer<typeof V9BenchmarkRunBaseSchema>;
type V9EvaluationTrialCandidate = V9BenchmarkRunCandidate["trials"][number];
type V9Invocation = V9EvaluationTrialCandidate["invocations"][number];

function calculatedBillingAmount(
	inputTokens: number,
	outputTokens: number,
	inputUsdPerMillionTokens: number,
	outputUsdPerMillionTokens: number,
): number {
	return (
		inputTokens * inputUsdPerMillionTokens +
		outputTokens * outputUsdPerMillionTokens
	) / 1_000_000;
}

function currentTrackOutcome(
	trial: V9EvaluationTrialCandidate,
	trackName: "main_story" | "announcements",
) {
	const writerStep: CurrentProductionModelStep =
		trackName === "main_story"
			? "main_story_write"
			: "announcements_write";
	const terminal = trial.invocations
		.filter(({ production_step }) => production_step === writerStep)
		.at(-1);
	if (terminal?.parse.state === "rejected") {
		if (
			terminal.parse.findings.some(({ kind }) => kind === "invalid_json")
		) {
			return "parse_rejected" as const;
		}
		if (
			terminal.parse.findings.some(({ kind }) => kind === "contract_mismatch")
		) {
			return "contract_rejected" as const;
		}
	}
	return terminal?.transport === "failed"
		? ("infrastructure_incomplete" as const)
		: ("completed" as const);
}

export function deriveCurrentTrialOutcome(trial: V9EvaluationTrialCandidate) {
	const outcomes = new Set([
		currentTrackOutcome(trial, "main_story"),
		currentTrackOutcome(trial, "announcements"),
	]);
	return (
		(
			[
				"infrastructure_incomplete",
				"parse_rejected",
				"contract_rejected",
				"completed",
			] as const
		).find((outcome) => outcomes.has(outcome)) ?? "completed"
	);
}

function refineInvocationRoster(
	trial: V9EvaluationTrialCandidate,
	benchmarkStartedAt: string,
	context: z.RefinementCtx,
): void {
	const ids = new Set<string>();
	const previousByStep = new Map<
		V9Invocation["production_step"],
		V9Invocation
	>();
	let previousStartedAt = Number.NEGATIVE_INFINITY;
	const lowerBound = Math.max(
		Date.parse(benchmarkStartedAt),
		Date.parse(trial.started_at),
	);
	for (const [index, invocation] of trial.invocations.entries()) {
		const startedAt = Date.parse(invocation.started_at);
		if (startedAt < lowerBound) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "started_at"],
				message: "invocation cannot start before its benchmark or trial",
			});
		}
		if (startedAt < previousStartedAt) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "started_at"],
				message: "invocation starts must be nondecreasing in ordinal order",
			});
		}
		previousStartedAt = startedAt;
		if (
			invocation.transport !== "in_flight" &&
			Date.parse(invocation.ended_at) < lowerBound
		) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "ended_at"],
				message: "invocation cannot end before its benchmark or trial",
			});
		}
		if (ids.has(invocation.id)) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "id"],
				message: "invocation ids must be unique",
			});
		}
		ids.add(invocation.id);
		if (invocation.ordinal !== index + 1) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "ordinal"],
				message: "invocation ordinals must be contiguous",
			});
		}
		if (invocation.config_identity !== trial.config_identity) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "config_identity"],
				message: "invocation config identity must equal its trial",
			});
		}
		const predecessor = previousByStep.get(invocation.production_step);
		if (predecessor === undefined) {
			if (invocation.predecessor_invocation_id !== null) {
				context.addIssue({
					code: "custom",
					path: ["invocations", index, "predecessor_invocation_id"],
					message:
						"first invocation for a production step must have no predecessor",
				});
			}
		} else {
			if (invocation.predecessor_invocation_id !== predecessor.id) {
				context.addIssue({
					code: "custom",
					path: ["invocations", index, "predecessor_invocation_id"],
					message:
						"later invocation must point to the immediately previous invocation for the same step",
				});
			}
			if (
				predecessor.transport !== "failed" ||
				predecessor.retry_classification.state !== "classified" ||
				!predecessor.retry_classification.eligible
			) {
				context.addIssue({
					code: "custom",
					path: ["invocations", index, "predecessor_invocation_id"],
					message:
						"retry predecessor must be a classified eligible transport failure",
				});
			}
			if (
				!canonicallyEqual(invocation.request, predecessor.request) ||
				invocation.request_sha256 !== predecessor.request_sha256
			) {
				context.addIssue({
					code: "custom",
					path: ["invocations", index, "request"],
					message:
						"retry request and request hash must equal its predecessor exactly",
				});
			}
		}
		previousByStep.set(invocation.production_step, invocation);
		if (
			invocation.parse.state === "rejected" &&
			invocation.parse.findings.some(
				({ production_step }) => production_step !== invocation.production_step,
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "parse", "findings"],
				message: "parse findings must belong to their invocation step",
			});
		}
		if (
			invocation.parse.state === "rejected" &&
			invocation.parse.findings.some(
				({ kind }) => kind !== "invalid_json" && kind !== "contract_mismatch",
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["invocations", index, "parse", "findings"],
				message:
					"parse rejection permits only malformed JSON or strict schema mismatch",
			});
		}
	}
}

function refineTrial(
	trial: V9EvaluationTrialCandidate,
	benchmarkStartedAt: string,
	context: z.RefinementCtx,
	trialIndex: number,
): void {
	const path = ["trials", trialIndex] as const;
	const issue = (relativePath: PropertyKey[], message: string) =>
		context.addIssue({
			code: "custom",
			path: [...path, ...relativePath],
			message,
		});
	for (const [index, invocation] of trial.invocations.entries()) {
		if (
			invocation.transport === "succeeded" &&
			invocation.completion.text === null
		) {
			issue(
				["invocations", index, "completion", "text"],
				"current V9 runs require textual completion content",
			);
		}
	}
	const trialContext: z.RefinementCtx = {
		value: context.value,
		issues: context.issues,
		addIssue(candidate) {
			if (typeof candidate === "string") {
				issue([], candidate);
				return;
			}
			context.addIssue({
				...candidate,
				path: [...path, ...(candidate.path ?? [])],
			});
		},
	};
	refineInvocationRoster(trial, benchmarkStartedAt, trialContext);
	for (const step of CURRENT_PRODUCTION_MODEL_STEPS) {
		const selectedId = trial.selected_invocation_ids[step];
		if (selectedId === null) {
			continue;
		}
		const selected = trial.invocations.find(({ id }) => id === selectedId);
		if (
			selected === undefined ||
			selected.production_step !== step ||
			selected.config_identity !== trial.config_identity ||
			selected.transport !== "succeeded" ||
			selected.parse.state !== "succeeded"
		) {
			issue(
				["selected_invocation_ids", step],
				"selected invocation must resolve to parsed success for the same step and config",
			);
		}
	}
	for (const trackName of ["main_story", "announcements"] as const) {
		const track = trial.tracks[trackName];
		const writerStep = `${trackName}_write` as const;
		const selectedWriter = trial.selected_invocation_ids[writerStep];
		const terminal = track.lifecycle === "completed" || track.lifecycle === "rejected";
		if (!terminal) {
			if (
				track.subject_outcome !== null ||
				track.terminal_production_step !== null ||
				track.product !== null ||
				track.findings.length > 0
			) {
				issue(
					["tracks", trackName],
					"nonterminal track cannot retain terminal data",
				);
			}
			continue;
		}
		if (
			track.subject_outcome === null ||
			track.terminal_production_step !== writerStep
		) {
			issue(
				["tracks", trackName],
				"terminal track must name its own writer outcome and production step",
			);
		}
		if (
			track.findings.some(
				({ production_step }) => production_step !== writerStep,
			)
		) {
			issue(
				["tracks", trackName, "findings"],
				"diagnostics must belong to the track writer step",
			);
		}
		if (
			track.lifecycle === "completed" &&
			(track.subject_outcome !== "completed" ||
				track.product === null ||
				selectedWriter === null)
		) {
			issue(
				["tracks", trackName],
				"completed track requires a selected writer, completed outcome, and retained product",
			);
		}
		if (track.lifecycle === "rejected") {
			if (track.subject_outcome !== currentTrackOutcome(trial, trackName)) {
				issue(
					["tracks", trackName, "subject_outcome"],
					"rejected track outcome must match retained terminal evidence",
				);
			}
			if (track.product !== null || track.findings.length !== 0) {
				issue(
					["tracks", trackName],
					"rejected track cannot retain a product or completed-track diagnostics",
				);
			}
			if (selectedWriter !== null) {
				issue(
					["selected_invocation_ids", writerStep],
					"writer-terminal rejection forbids selecting a usable invocation",
				);
			}
		}
	}
	if (trial.lifecycle === "running") {
		if (trial.completed_at !== null || trial.subject_outcome !== null) {
			issue(["lifecycle"], "running trial cannot be terminal");
		}
		return;
	}
	if (
		trial.completed_at === null ||
		trial.subject_outcome === null ||
		Object.values(trial.tracks).some(
			({ lifecycle }) =>
				lifecycle !== "completed" && lifecycle !== "rejected",
		)
	) {
		issue(
			["lifecycle"],
			"complete trial requires terminal tracks, time, and outcome",
		);
	}
	if (
		trial.invocations.some(
			(invocation) =>
				invocation.transport === "in_flight" ||
				(invocation.transport === "failed" &&
					invocation.retry_classification.state === "pending") ||
				(invocation.transport === "succeeded" &&
					invocation.parse.state === "pending"),
		)
	) {
		issue(
			["invocations"],
			"complete trial cannot retain pending invocation work",
		);
	}
	if (trial.subject_outcome !== deriveCurrentTrialOutcome(trial)) {
		issue(["subject_outcome"], "trial outcome must match its terminal tracks");
	}
	const latestReached = Math.max(
		Date.parse(trial.started_at),
		...trial.invocations.flatMap((invocation) =>
			invocation.transport === "in_flight"
				? [Date.parse(invocation.started_at)]
				: [
						Date.parse(invocation.started_at),
						Date.parse(invocation.ended_at),
				  ],
		),
	);
	if (
		trial.completed_at !== null
		&& Date.parse(trial.completed_at) < latestReached
	) {
		issue(
			["completed_at"],
			"trial completion cannot precede reached invocation timing or trial start",
		);
	}
}

function expectedOutcomeCounts(run: V9BenchmarkRunCandidate) {
	const counts = {
		completed: 0,
		parse_rejected: 0,
		contract_rejected: 0,
		infrastructure_incomplete: 0,
	};
	for (const trial of run.trials) {
		if (trial.lifecycle === "complete" && trial.subject_outcome !== null) {
			counts[trial.subject_outcome] += 1;
		}
	}
	return counts;
}

export const V9BenchmarkRunSchema = V9BenchmarkRunBaseSchema.superRefine(
	(run, context) => {
		const configurationIds = new Set<string>();
		for (const [index, declaration] of run.declaration.configurations.entries()) {
			if (declaration.identity !== evaluationConfigIdentity(declaration.config)) {
				context.addIssue({
					code: "custom",
					path: ["declaration", "configurations", index, "identity"],
					message:
						"configuration identity must derive from its exact config",
				});
			}
			if (configurationIds.has(declaration.identity)) {
				context.addIssue({
					code: "custom",
					path: ["declaration", "configurations", index, "identity"],
					message: "configuration identities must be unique",
				});
			}
			configurationIds.add(declaration.identity);
			if (
				Object.values(declaration.config.production_steps).some(
					({ adapter }) => adapter === "recorded",
				)
			) {
				context.addIssue({
					code: "custom",
					path: ["declaration", "configurations", index, "config"],
					message:
						"current live artifacts cannot declare a recorded adapter",
				});
			}
		}
		const expectedRoster = run.declaration.configurations.flatMap(
			(configuration) =>
				Array.from(
					{ length: run.declaration.repetition_count },
					(_, repetitionIndex) => ({
						config_identity: configuration.identity,
						repetition: repetitionIndex + 1,
					}),
				),
		);
		if (run.trial_roster.length !== expectedRoster.length) {
			context.addIssue({
				code: "custom",
				path: ["trial_roster"],
				message:
					"trial roster must be the complete declared configuration and repetition product",
			});
		}
		const trialIds = new Set<string>();
		for (const [index, member] of run.trial_roster.entries()) {
			const expected = expectedRoster[index];
			if (
				expected === undefined ||
				member.config_identity !== expected.config_identity ||
				member.repetition !== expected.repetition
			) {
				context.addIssue({
					code: "custom",
					path: ["trial_roster", index],
					message:
						"trial roster must preserve configuration declaration order then repetition order",
				});
			}
			if (trialIds.has(member.trial_id)) {
				context.addIssue({
					code: "custom",
					path: ["trial_roster", index, "trial_id"],
					message: "trial roster ids must be unique",
				});
			}
			trialIds.add(member.trial_id);
		}
		if (run.trials.length > run.trial_roster.length) {
			context.addIssue({
				code: "custom",
				path: ["trials"],
				message: "retained trials cannot exceed the declared roster",
			});
		}
		for (const [trialIndex, trial] of run.trials.entries()) {
			const roster = run.trial_roster[trialIndex];
			if (
				roster === undefined ||
				trial.id !== roster.trial_id ||
				trial.config_identity !== roster.config_identity ||
				trial.repetition !== roster.repetition
			) {
				context.addIssue({
					code: "custom",
					path: ["trials", trialIndex],
					message:
						"trials must be an identity-exact prefix of the declared roster",
				});
			}
			if (trialIndex < run.trials.length - 1 && trial.lifecycle !== "complete") {
				context.addIssue({
					code: "custom",
					path: ["trials", trialIndex, "lifecycle"],
					message: "only the final retained trial may be running",
				});
			}
			if (Date.parse(trial.started_at) < Date.parse(run.started_at)) {
				context.addIssue({
					code: "custom",
					path: ["trials", trialIndex, "started_at"],
					message: "trial cannot start before its benchmark",
				});
			}
			const previousTrial = run.trials[trialIndex - 1];
			if (
				previousTrial?.completed_at !== null &&
				previousTrial?.completed_at !== undefined &&
				Date.parse(trial.started_at) < Date.parse(previousTrial.completed_at)
			) {
				context.addIssue({
					code: "custom",
					path: ["trials", trialIndex, "started_at"],
					message:
						"serial trial cannot start before its predecessor completed",
				});
			}
			refineTrial(trial, run.started_at, context, trialIndex);
			for (const productionStep of CURRENT_PRODUCTION_MODEL_STEPS) {
				if (
					trial.invocations.filter(
						({ production_step }) => production_step === productionStep,
					).length >
					run.declaration.transport_retry_limit + 1
				) {
					context.addIssue({
						code: "custom",
						path: ["trials", trialIndex, "invocations"],
						message:
							"production-step invocation count cannot exceed the declared transport retry limit",
					});
				}
			}
		}
		const evidence = run.prepared_evidence;
		if (
			evidence.identity_sha256 !== sha256Json(evidence.snapshot) ||
			evidence.active_region_id !== evidence.snapshot.active_region_id ||
			evidence.publication_date !== evidence.snapshot.publication_date ||
			evidence.original_count !== evidence.snapshot.raw_count ||
			evidence.final_count !== evidence.snapshot.final_count
		) {
			context.addIssue({
				code: "custom",
				path: ["prepared_evidence"],
				message:
					"prepared-evidence identity and summary must bind the retained snapshot",
			});
		}
		if (!canonicallyEqual(run.outcome_counts, expectedOutcomeCounts(run))) {
			context.addIssue({
				code: "custom",
				path: ["outcome_counts"],
				message: "outcome counts must exactly count retained terminal trials",
			});
		}
		if (
			run.lifecycle === "running" &&
			(run.completed_at !== null || run.harness_outcome !== "pending")
		) {
			context.addIssue({
				code: "custom",
				path: ["lifecycle"],
				message:
					"running benchmark requires null completion and pending harness outcome",
			});
		}
		if (run.lifecycle === "complete") {
			if (
				run.completed_at === null ||
				run.harness_outcome !== "retained" ||
				run.trials.length !== run.trial_roster.length ||
				run.trials.some(({ lifecycle }) => lifecycle !== "complete")
			) {
				context.addIssue({
					code: "custom",
					path: ["lifecycle"],
					message:
						"complete benchmark requires every roster trial terminal and retained harness outcome",
				});
			}
			if (run.completed_at !== null) {
				const lastTrialCompletion = Math.max(
					Date.parse(run.started_at),
					...run.trials.map(({ completed_at }) =>
						completed_at === null
							? Number.POSITIVE_INFINITY
							: Date.parse(completed_at),
					),
				);
				if (Date.parse(run.completed_at) < lastTrialCompletion) {
					context.addIssue({
						code: "custom",
						path: ["completed_at"],
						message:
							"benchmark completion cannot precede retained trial completion",
					});
				}
			}
		}

		const expectedInvocations = run.trials.flatMap((trial) =>
			trial.invocations.map((invocation) => ({
				trial_id: trial.id,
				invocation_id: invocation.id,
				config_identity: invocation.config_identity,
				production_step: invocation.production_step,
				ordinal: invocation.ordinal,
				transport: invocation.transport,
			})),
		);
		if (run.runtime_evidence.length !== expectedInvocations.length) {
			context.addIssue({
				code: "custom",
				path: ["runtime_evidence"],
				message:
					"runtime-evidence roster must contain exactly one entry for every retained invocation",
			});
		}
		if (run.gateway_requests.length !== expectedInvocations.length) {
			context.addIssue({
				code: "custom",
				path: ["gateway_requests"],
				message:
					"Gateway-request roster must contain exactly one entry for every retained invocation",
			});
		}
		const runtimeInvocationIds = new Set<string>();
		const gatewayInvocationIds = new Set<string>();
		for (const [index, expected] of expectedInvocations.entries()) {
			const evidence = run.runtime_evidence[index];
			if (
				evidence === undefined ||
				evidence.trial_id !== expected.trial_id ||
				evidence.invocation_id !== expected.invocation_id ||
				evidence.config_identity !== expected.config_identity ||
				evidence.production_step !== expected.production_step ||
				evidence.ordinal !== expected.ordinal
			) {
				context.addIssue({
					code: "custom",
					path: ["runtime_evidence", index],
					message:
						"runtime-evidence roster must preserve trial-roster order then invocation ordinal and match invocation identity",
				});
			}
			if (evidence !== undefined) {
				if (runtimeInvocationIds.has(evidence.invocation_id)) {
					context.addIssue({
						code: "custom",
						path: ["runtime_evidence", index, "invocation_id"],
						message: "runtime-evidence invocation ids must be unique",
					});
				}
				runtimeInvocationIds.add(evidence.invocation_id);
				if (
					expected.transport === "in_flight" &&
					evidence.state !== "pending"
				) {
					context.addIssue({
						code: "custom",
						path: ["runtime_evidence", index, "state"],
						message:
							"in-flight invocation runtime evidence must be pending",
					});
				}
				if (
					expected.transport === "failed" &&
					evidence.state !== "unavailable"
				) {
					context.addIssue({
						code: "custom",
						path: ["runtime_evidence", index, "state"],
						message:
							"failed invocation runtime evidence must be unavailable",
					});
				}
				if (
					expected.transport === "succeeded" &&
					evidence.state !== "captured"
				) {
					context.addIssue({
						code: "custom",
						path: ["runtime_evidence", index, "state"],
						message:
							"succeeded invocation runtime evidence must be captured",
					});
				}
			}

			const gateway = run.gateway_requests[index];
			if (
				gateway === undefined ||
				gateway.trial_id !== expected.trial_id ||
				gateway.invocation_id !== expected.invocation_id ||
				gateway.config_identity !== expected.config_identity ||
				gateway.production_step !== expected.production_step ||
				gateway.ordinal !== expected.ordinal
			) {
				context.addIssue({
					code: "custom",
					path: ["gateway_requests", index],
					message:
						"Gateway-request roster must preserve invocation order and identity",
				});
			}
			if (gateway !== undefined) {
				if (gatewayInvocationIds.has(gateway.invocation_id)) {
					context.addIssue({
						code: "custom",
						path: ["gateway_requests", index, "invocation_id"],
						message: "Gateway-request invocation ids must be unique",
					});
				}
				gatewayInvocationIds.add(gateway.invocation_id);
				if (
					expected.transport === "in_flight" &&
					gateway.state !== "pending"
				) {
					context.addIssue({
						code: "custom",
						path: ["gateway_requests", index, "state"],
						message:
							"in-flight Gateway-request evidence must be pending",
					});
				}
				if (
					expected.transport === "failed" &&
					gateway.state !== "unavailable"
				) {
					context.addIssue({
						code: "custom",
						path: ["gateway_requests", index, "state"],
						message:
							"failed Gateway-request evidence must be unavailable",
					});
				}
				if (
					expected.transport === "succeeded" &&
					!["captured", "not_applicable"].includes(gateway.state)
				) {
					context.addIssue({
						code: "custom",
						path: ["gateway_requests", index, "state"],
						message:
							"successful invocation must retain captured or not_applicable Gateway evidence",
					});
				}
				if (expected.transport !== "succeeded") {
					continue;
				}
				const declaration = run.declaration.configurations.find(({ identity }) => identity === gateway.config_identity);
				const adapter = declaration?.config.production_steps[gateway.production_step];
				let expectedReasoningPosture: "provider_default" | "thinking_enabled" | "thinking_disabled" = "provider_default";
				if (adapter?.adapter === "lmstudio" && adapter.enable_thinking === true) {
					expectedReasoningPosture = "thinking_enabled";
				}
				if (adapter?.adapter === "lmstudio" && adapter.enable_thinking === false) {
					expectedReasoningPosture = "thinking_disabled";
				}
				const retainedInvocation = run.trials
					.flatMap(({ invocations }) => invocations)
					.find(({ id }) => id === gateway.invocation_id);
				if (
					evidence?.state === "captured" &&
					(evidence.evidence.execution_context.requested_reasoning_posture
						.state !== "observed" ||
						evidence.evidence.execution_context.requested_reasoning_posture.value !==
							expectedReasoningPosture)
				) {
					context.addIssue({
						code: "custom",
						path: [
							"runtime_evidence",
							index,
							"evidence",
							"execution_context",
							"requested_reasoning_posture",
						],
						message: `captured runtime evidence must retain the ${expectedReasoningPosture} reasoning posture`,
					});
				}
				if (
					retainedInvocation?.transport === "succeeded" &&
					evidence?.state === "captured" &&
					evidence.evidence.execution_context.response_model.identifier.state ===
						"observed" &&
					evidence.evidence.execution_context.response_model.identifier.value !==
						retainedInvocation.completion.model
				) {
					context.addIssue({
						code: "custom",
						path: [
							"runtime_evidence",
							index,
							"evidence",
							"execution_context",
							"response_model",
							"identifier",
						],
						message:
							"captured runtime evidence must bind the retained completion model identifier",
					});
				}
				if (retainedInvocation?.transport === "succeeded" && retainedInvocation.completion.text === null) {
					context.addIssue({
						code: "custom",
						path: ["trials"],
						message:
							"current V9 runs require textual completion content",
					});
				}
				if (
					retainedInvocation?.transport === "succeeded" &&
					evidence?.state === "captured" &&
					adapter !== undefined &&
					adapter.adapter !== "recorded" &&
					adapter.adapter !== "cloudflare_ai_gateway" &&
					(evidence.evidence.execution_context.selected_model.requested_identity
						.state !== "observed" ||
						evidence.evidence.execution_context.selected_model.requested_identity
							.value !== adapter.model)
				) {
					context.addIssue({
						code: "custom",
						path: [
							"runtime_evidence",
							index,
							"evidence",
							"execution_context",
							"selected_model",
							"requested_identity",
						],
						message:
							"captured runtime evidence must bind the declared requested model",
					});
				}
				if (
					retainedInvocation?.transport === "succeeded" &&
					adapter?.adapter === "openai_compatible_hosted"
				) {
					if (retainedInvocation.completion.execution !== "hosted_inference") {
						context.addIssue({
							code: "custom",
							path: ["trials"],
							message:
								"hosted adapter completion must retain hosted inference execution",
						});
					}
					if (retainedInvocation.completion.provider !== adapter.provider) {
						context.addIssue({
							code: "custom",
							path: ["trials"],
							message:
								"hosted adapter completion provider must match the declared provider",
						});
					}
					if (
						retainedInvocation.completion.token_usage.measurement !== "reported"
					) {
						context.addIssue({
							code: "custom",
							path: ["trials"],
							message:
								"hosted adapter completion must retain reported token usage",
						});
					} else {
						const expectedAmount = calculatedBillingAmount(
							retainedInvocation.completion.token_usage.input_tokens,
							retainedInvocation.completion.token_usage.output_tokens,
							adapter.billing.input_usd_per_million_tokens,
							adapter.billing.output_usd_per_million_tokens,
						);
						if (
							retainedInvocation.completion.external_billing
								.classification !== "calculated" ||
							retainedInvocation.completion.external_billing.amount_usd !==
								expectedAmount ||
							retainedInvocation.completion.external_billing
								.pricing_reference !== adapter.billing.pricing_reference
						) {
							context.addIssue({
								code: "custom",
								path: ["trials"],
								message:
									"hosted adapter billing must match the declared calculated pricing",
							});
						}
					}
				}
				if (
					retainedInvocation?.transport === "succeeded" &&
					adapter?.adapter === "lmstudio" &&
					(!canonicallyEqual(retainedInvocation.completion.external_billing, {
						classification: "none",
						amount_usd: 0,
						reason: "local_inference",
					}) ||
						retainedInvocation.completion.execution !== "local_inference")
				) {
					context.addIssue({
						code: "custom",
						path: ["trials"],
						message:
							"LM Studio completion must retain local inference execution and no external billing",
					});
				}
				if (adapter?.adapter === "cloudflare_ai_gateway") {
					if (gateway.state !== "captured") {
						context.addIssue({
							code: "custom",
							path: ["gateway_requests", index, "state"],
							message:
								"successful Cloudflare AI Gateway invocation must retain captured Gateway provenance",
						});
						continue;
					}
					const requestProfile = Object.prototype.hasOwnProperty.call(
						CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES,
						adapter.model,
					)
						? CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[
							adapter.model as keyof typeof CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES
						]
						: undefined;
					if (requestProfile === undefined) {
						context.addIssue({
							code: "custom",
							path: ["gateway_requests", index, "provenance", "requested_model"],
							message:
								"captured Gateway provenance must use an admitted profiled model",
						});
						continue;
					}
					const expectedGateway = adapter.gateway ?? { selection: "account_default" as const };
					if (
						gateway.provenance.gateway.selection !== expectedGateway.selection ||
						(gateway.provenance.gateway.selection === "named" &&
							expectedGateway.selection === "named" &&
							gateway.provenance.gateway.id !== expectedGateway.id) ||
						gateway.provenance.requested_model !== adapter.model ||
						gateway.provenance.correlation.run_id !== run.id ||
						gateway.provenance.correlation.invocation_id !== gateway.invocation_id
					) {
						context.addIssue({
							code: "custom",
							path: ["gateway_requests", index, "provenance"],
							message:
								"captured Gateway provenance must bind the declared adapter and invocation correlation",
						});
					}
					if (
						gateway.provenance.policy.request_format !== requestProfile.requestFormat ||
						gateway.provenance.policy.response_delivery !== requestProfile.responseDelivery ||
						gateway.provenance.policy.structured_output.format !== requestProfile.structuredOutputFormat ||
						gateway.provenance.policy.structured_output.contract_name !== CURRENT_OUTPUT_CONTRACT_NAMES[gateway.production_step]
					) {
						context.addIssue({
							code: "custom",
							path: ["gateway_requests", index, "provenance", "policy"],
							message:
								"captured Gateway provenance must retain the exact profiled request policy and output contract",
						});
					}
					if (
						retainedInvocation?.transport === "succeeded" &&
						retainedInvocation.completion.provider !==
							cloudflareAiGatewayProviderForModel(adapter.model)
					) {
						context.addIssue({
							code: "custom",
							path: ["trials"],
							message:
								"Gateway completion provider must derive from the declared routed model",
						});
					}
				} else if (gateway.state !== "not_applicable") {
					context.addIssue({
						code: "custom",
						path: ["gateway_requests", index, "state"],
						message:
							"successful non-Gateway invocation must mark Gateway provenance not applicable",
					});
				}
			}
		}
	},
);

export type RuntimeEvidenceRecord = z.infer<typeof RuntimeEvidenceRecordSchema>;
export type GatewayRequestRecord = z.infer<typeof GatewayRequestRecordSchema>;
export type V9EvaluationTrial = z.infer<typeof V9BenchmarkRunSchema>["trials"][number];
export type V9BenchmarkRun = z.infer<typeof V9BenchmarkRunSchema>;
