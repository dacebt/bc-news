import { z } from "zod";
import { ModelRequestProvenanceSchema } from "@bc-news/generation-core";
import {
	CloudflareAiGatewayAdapterConfigSchema,
	cloudflareAiGatewayProviderForModel,
} from "@bc-news/model-adapters";
import {
	EvaluationIdSchema,
	evaluationConfigIdentity,
} from "./evaluation-artifact-schemas";
import { V6ModelAdapterConfigSchema } from "./evaluation-artifact-v6";
import { V7BenchmarkRunBaseSchema, V7BenchmarkRunSchema } from "./evaluation-artifact-v7";
import { V1ProductionModelStepSchema } from "./evaluation-artifact-v1-contracts";

export const V8ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	...V6ModelAdapterConfigSchema.options,
	CloudflareAiGatewayAdapterConfigSchema,
]);

export const V8EvalConfigSchema = z.strictObject({
	production_steps: z.strictObject({
		main_story_write: V8ModelAdapterConfigSchema,
		main_story_copyedit: V8ModelAdapterConfigSchema,
		announcements_write: V8ModelAdapterConfigSchema,
		announcements_copyedit: V8ModelAdapterConfigSchema,
	}),
});

const GatewayRequestIdentitySchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	invocation_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	production_step: V1ProductionModelStepSchema,
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

const DeclaredConfigurationSchema = z.strictObject({
	identity: EvaluationIdSchema,
	config: V8EvalConfigSchema,
});

export const V8BenchmarkRunBaseSchema = V7BenchmarkRunBaseSchema.omit({
	version: true,
	declaration: true,
}).extend({
	version: z.literal(8),
	declaration: z.strictObject({
		configurations: z.array(DeclaredConfigurationSchema).min(1),
		repetition_count: z.number().int().positive(),
		transport_retry_limit: z.number().int().min(0).max(3),
	}),
	gateway_requests: z.array(GatewayRequestRecordSchema),
});

type V8Candidate = z.infer<typeof V8BenchmarkRunBaseSchema>;

function legacyAdapter(adapter: z.infer<typeof V8ModelAdapterConfigSchema>) {
	if (adapter.adapter !== "cloudflare_ai_gateway") return adapter;
	const gatewayIdentity = adapter.gateway === undefined
		? "account_default"
		: `named:${adapter.gateway.id}`;
	return {
		adapter: "openai_compatible_hosted" as const,
		provider: `cloudflare_ai_gateway:${cloudflareAiGatewayProviderForModel(adapter.model)}:${gatewayIdentity}`,
		model: adapter.model,
		...(adapter.temperature === undefined ? {} : { temperature: adapter.temperature }),
		billing: {
			method: "calculated" as const,
			input_usd_per_million_tokens: 0,
			output_usd_per_million_tokens: 0,
			pricing_reference: "v8-legacy-invariant-projection",
		},
	};
}

function legacyProjection(run: V8Candidate): unknown {
	const declarations = new Map(run.declaration.configurations.map((declaration) => [declaration.identity, declaration.config]));
	const configurations = run.declaration.configurations.map((declaration) => {
		const config = {
			production_steps: {
				main_story_write: legacyAdapter(declaration.config.production_steps.main_story_write),
				main_story_copyedit: legacyAdapter(declaration.config.production_steps.main_story_copyedit),
				announcements_write: legacyAdapter(declaration.config.production_steps.announcements_write),
				announcements_copyedit: legacyAdapter(declaration.config.production_steps.announcements_copyedit),
			},
		};
		return { originalIdentity: declaration.identity, identity: evaluationConfigIdentity(config), config };
	});
	const identities = new Map(configurations.map(({ originalIdentity, identity }) => [originalIdentity, identity]));
	const projectedDeclarations = new Map(configurations.map(({ originalIdentity, config }) => [originalIdentity, config]));
	const mapIdentity = (identity: string) => identities.get(identity) ?? identity;
	const projected = {
		...run,
		version: 7,
		declaration: {
			...run.declaration,
			configurations: configurations.map(({ identity, config }) => ({ identity, config })),
		},
		trial_roster: run.trial_roster.map((member) => ({ ...member, config_identity: mapIdentity(member.config_identity) })),
		trials: run.trials.map((trial) => ({
			...trial,
			config_identity: mapIdentity(trial.config_identity),
			invocations: trial.invocations.map((invocation) => {
				const adapter = declarations.get(invocation.config_identity)?.production_steps[invocation.production_step];
				const projectedAdapter = projectedDeclarations.get(invocation.config_identity)?.production_steps[invocation.production_step];
				return {
					...invocation,
					config_identity: mapIdentity(invocation.config_identity),
					...(invocation.transport === "succeeded" ? {
						completion: {
							...invocation.completion,
							text: invocation.completion.text ?? "null",
							...(adapter?.adapter === "cloudflare_ai_gateway" ? {
								provider: projectedAdapter?.adapter === "openai_compatible_hosted"
									? projectedAdapter.provider
									: invocation.completion.provider,
								external_billing: {
									classification: "calculated" as const,
									amount_usd: 0,
									pricing_reference: "v8-legacy-invariant-projection",
								},
							} : {}),
						},
						} : {}),
				};
			}),
		})),
		runtime_evidence: run.runtime_evidence.map((evidence) => ({
			...evidence,
			config_identity: mapIdentity(evidence.config_identity),
		})),
	};
	delete (projected as Partial<typeof projected> & { gateway_requests?: unknown }).gateway_requests;
	return projected;
}

export const V8BenchmarkRunSchema = V8BenchmarkRunBaseSchema.superRefine((run, context) => {
	const legacy = V7BenchmarkRunSchema.safeParse(legacyProjection(run));
	if (!legacy.success) {
		for (const issue of legacy.error.issues) {
			context.addIssue({
				code: "custom",
				path: issue.path,
				message: `artifact version 8 must preserve the version 7 benchmark invariant: ${issue.message}`,
			});
		}
	}

	const identities = new Set<string>();
	for (const [index, declaration] of run.declaration.configurations.entries()) {
		if (declaration.identity !== evaluationConfigIdentity(declaration.config)) {
			context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identity must derive from its exact config" });
		}
		if (identities.has(declaration.identity)) {
			context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identities must be unique" });
		}
		identities.add(declaration.identity);
	}

	const expected = run.trials.flatMap((trial) => trial.invocations.map((invocation) => ({
		trial_id: trial.id,
		invocation_id: invocation.id,
		config_identity: invocation.config_identity,
		production_step: invocation.production_step,
		ordinal: invocation.ordinal,
		transport: invocation.transport,
	})));
	if (run.gateway_requests.length !== expected.length) {
		context.addIssue({ code: "custom", path: ["gateway_requests"], message: "Gateway-request roster must contain exactly one entry for every retained invocation" });
	}
	const invocationIds = new Set<string>();
	for (const [index, record] of run.gateway_requests.entries()) {
		const invocation = expected[index];
		if (invocation === undefined
			|| record.trial_id !== invocation.trial_id
			|| record.invocation_id !== invocation.invocation_id
			|| record.config_identity !== invocation.config_identity
			|| record.production_step !== invocation.production_step
			|| record.ordinal !== invocation.ordinal) {
			context.addIssue({ code: "custom", path: ["gateway_requests", index], message: "Gateway-request roster must preserve invocation order and identity" });
		}
		if (invocationIds.has(record.invocation_id)) {
			context.addIssue({ code: "custom", path: ["gateway_requests", index, "invocation_id"], message: "Gateway-request invocation ids must be unique" });
		}
		invocationIds.add(record.invocation_id);
		if (invocation?.transport === "in_flight" && record.state !== "pending") {
			context.addIssue({ code: "custom", path: ["gateway_requests", index, "state"], message: "in-flight Gateway-request evidence must be pending" });
		}
		if (invocation?.transport === "failed" && record.state !== "unavailable") {
			context.addIssue({ code: "custom", path: ["gateway_requests", index, "state"], message: "failed Gateway-request evidence must be unavailable" });
		}
		if (invocation?.transport !== "succeeded") continue;
		const declaration = run.declaration.configurations.find(({ identity }) => identity === record.config_identity);
		const adapter = declaration?.config.production_steps[record.production_step];
		const retainedInvocation = run.trials.flatMap(({ invocations }) => invocations).find(({ id }) => id === record.invocation_id);
		if (retainedInvocation?.transport === "succeeded"
			&& retainedInvocation.completion.text === null
			&& adapter?.adapter !== "cloudflare_ai_gateway") {
			context.addIssue({ code: "custom", path: ["trials"], message: "Only a Cloudflare AI Gateway invocation may retain explicit null completion content" });
		}
		if (adapter?.adapter === "cloudflare_ai_gateway") {
			if (record.state !== "captured") {
				context.addIssue({ code: "custom", path: ["gateway_requests", index, "state"], message: "successful Cloudflare AI Gateway invocation must retain captured Gateway provenance" });
				continue;
			}
			const expectedGateway = adapter.gateway ?? { selection: "account_default" as const };
			if (record.provenance.gateway.selection !== expectedGateway.selection
				|| (record.provenance.gateway.selection === "named" && expectedGateway.selection === "named" && record.provenance.gateway.id !== expectedGateway.id)
				|| record.provenance.requested_model !== adapter.model
				|| record.provenance.correlation.run_id !== run.id
				|| record.provenance.correlation.invocation_id !== record.invocation_id) {
				context.addIssue({ code: "custom", path: ["gateway_requests", index, "provenance"], message: "captured Gateway provenance must bind the declared adapter and invocation correlation" });
			}
			if (retainedInvocation?.transport === "succeeded"
				&& retainedInvocation.completion.provider !== cloudflareAiGatewayProviderForModel(adapter.model)) {
				context.addIssue({ code: "custom", path: ["trials"], message: "Gateway completion provider must derive from the declared routed model" });
			}
		} else if (record.state !== "not_applicable") {
			context.addIssue({ code: "custom", path: ["gateway_requests", index, "state"], message: "successful non-Gateway invocation must mark Gateway provenance not applicable" });
		}
	}
});

export type GatewayRequestRecord = z.infer<typeof GatewayRequestRecordSchema>;
export type V8EvaluationTrial = z.infer<typeof V8BenchmarkRunSchema>["trials"][number];
export type V8BenchmarkRun = z.infer<typeof V8BenchmarkRunSchema>;
