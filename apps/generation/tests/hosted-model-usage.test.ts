import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { modelUsageRecord, type ModelCompletion } from "@bc-news/generation-core";
import { generationRunAttemptInvocationId } from "../src/generation-run-instance-id";
import {
	queueGenerationRunStatus,
	readGenerationRunStatus,
	recordGenerationRunProgress,
} from "../src/generation-run-status";

it("retains hosted completion usage and calculated billing in the D1 operator projection", async () => {
	const params = { active_region_id: "7", publication_date: "2026-02-01" } as const;
	const completion: ModelCompletion = {
		text: "retained separately from usage",
		provider: "verify-hosted",
		model: "returned-hosted-model",
		execution: "hosted_inference",
		token_usage: {
			measurement: "reported",
			input_tokens: 125,
			output_tokens: 25,
			total_tokens: 150,
		},
		external_billing: {
			classification: "calculated",
			amount_usd: 0.0003375,
			pricing_reference: "verify-prices-2026-08-04",
		},
	};
	const usage = modelUsageRecord("main_story_write", completion);

	await queueGenerationRunStatus(env.DB, params, "2026-08-05T00:00:00.000Z");
	await recordGenerationRunProgress(
		env.DB,
		params,
		{
			currentStep: "announcements_write",
			completedSteps: ["prepare-evidence", "main_story_write"],
			modelUsage: [usage],
			modelAttempts: [{
				production_step: "main_story_write",
				attempt: 1,
				invocation_id: generationRunAttemptInvocationId(params, "main_story_write", 1),
				outcome: { status: "accepted" },
				model_usage: usage,
			}],
			diagnostics: [],
		},
		"2026-08-05T00:00:01.000Z",
	);

	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		model_usage: [usage],
		model_attempts: [{
			production_step: "main_story_write",
			attempt: 1,
			invocation_id: generationRunAttemptInvocationId(params, "main_story_write", 1),
			outcome: { status: "accepted" },
			model_usage: usage,
		}],
		diagnostics: [],
	});
});
