import type { WalkContext, WalkPhase } from "../phase";
import { triggerGenerationRun } from "../edition-api";

async function run(ctx: WalkContext): Promise<void> {
	const trigger = await triggerGenerationRun(ctx);
	if (trigger.status !== 202) {
		throw new Error(`generation run trigger expected 202, got ${trigger.status} ${trigger.body}`);
	}
	console.log(`walk: generation run accepted: ${trigger.body}`);
}

export const walkPhase: WalkPhase = { name: "trigger-generation-run", run };
