import { expect, it } from "vitest";
import {
	WALK_RECORDED_MODEL_CONFIG,
	walkGenerationWranglerDevArguments,
} from "../../../scripts/walk/wrangler-dev-command";

it("forces recorded generation adapters ahead of live developer configuration", () => {
	const developerModelConfig = JSON.stringify({
		main_story_write: { adapter: "openai_compatible_hosted", provider: "live", model: "paid", temperature: 0.7 },
		main_story_copyedit: { adapter: "lmstudio", model: "local", temperature: 0.2, reasoning_effort: "provider_default" },
		announcements_write: { adapter: "lmstudio", model: "local", temperature: 0.6, reasoning_effort: "provider_default" },
		announcements_copyedit: { adapter: "lmstudio", model: "local", temperature: 0.3, reasoning_effort: "provider_default" },
	});
	const args = walkGenerationWranglerDevArguments({
		port: 8787,
		persistDir: "/tmp/walk-proof",
	});

	expect(JSON.parse(WALK_RECORDED_MODEL_CONFIG)).toEqual({
		main_story_write: { adapter: "recorded" },
		main_story_copyedit: { adapter: "recorded" },
		announcements_write: { adapter: "recorded" },
		announcements_copyedit: { adapter: "recorded" },
	});
	expect(args).toContain(`MODEL_CONFIG:${WALK_RECORDED_MODEL_CONFIG}`);
	expect(args.join(" ")).not.toContain(developerModelConfig);
});
