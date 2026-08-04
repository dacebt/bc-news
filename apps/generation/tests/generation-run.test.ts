import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { recordedModelProvider } from "@bc-news/fixtures";
import { readEdition } from "../src/edition-store";

it("interrupted run does not repeat the model call", async () => {
	const modelCalls = vi.spyOn(recordedModelProvider, "complete");
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-01-25",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
		await m.mockStepError({ name: "publish-edition" }, new Error("transient publish failure"), 1);
	});

	await env.GENERATION_RUN.create({
		id: "generation-run-7-2026-01-25",
		params: { active_region_id: "7", publication_date: "2026-01-25" },
	});
	await instance.waitForStatus("complete");

	expect(modelCalls).toHaveBeenCalledTimes(1);
	const served = await readEdition(env.DB, "7", "2026-01-25");
	expect(served?.active_region_id).toBe("7");
});
