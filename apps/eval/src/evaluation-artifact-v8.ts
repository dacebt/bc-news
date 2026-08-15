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
import { V7BenchmarkRunBaseSchema, V7ModelAdapterConfigSchema, refineCurrentBenchmarkRun, type CurrentBenchmarkRunCandidate } from "./evaluation-artifact-v7";
import { ProductionModelStepSchema } from "@bc-news/generation-core";

export const V8ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	...V7ModelAdapterConfigSchema.options,
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
	production_step: ProductionModelStepSchema,
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

export const V8BenchmarkRunSchema = V8BenchmarkRunBaseSchema.superRefine((run, context) => {
	refineCurrentBenchmarkRun(run as unknown as CurrentBenchmarkRunCandidate, context, true);
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
