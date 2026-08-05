import { expect, it } from "vitest";
import {
	WALK_RECORDED_MODEL_CONFIG,
	walkGenerationWranglerDevArguments,
} from "../../../scripts/walk/wrangler-dev-command";

it("forces recorded generation adapters ahead of live developer configuration", () => {
	const developerModelConfig = JSON.stringify({
		main_story: { adapter: "openai_compatible_hosted", provider: "live", model: "paid" },
		announcements: { adapter: "lmstudio", model: "local" },
		packaging: { adapter: "lmstudio", model: "local" },
	});
	const args = walkGenerationWranglerDevArguments({
		port: 8787,
		persistDir: "/tmp/walk-proof",
	});

	expect(JSON.parse(WALK_RECORDED_MODEL_CONFIG)).toEqual({
		main_story: { adapter: "recorded" },
		announcements: { adapter: "recorded" },
		packaging: { adapter: "recorded" },
	});
	expect(args).toContain(`MODEL_CONFIG:${WALK_RECORDED_MODEL_CONFIG}`);
	expect(args.join(" ")).not.toContain(developerModelConfig);
});
