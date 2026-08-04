import type { WalkContext, WalkPhase } from "../phase";
import { editionUrl, triggerGenerationRun } from "../edition-api";

async function run(ctx: WalkContext): Promise<void> {
	if (ctx.state.firstServedEditionBody === undefined) {
		throw new Error(
			"idempotency phase requires ctx.state.firstServedEditionBody from the publish-poll phase, but it is absent",
		);
	}
	const firstServedEditionBody = ctx.state.firstServedEditionBody;

	const duplicate = await triggerGenerationRun(ctx);
	console.log(
		`walk: duplicate generation run signal recorded: ${duplicate.status} ${duplicate.body}`,
	);
	if (duplicate.status !== 202 && duplicate.status !== 409) {
		throw new Error(
			`duplicate trigger expected the recorded local no-op 202 or the documented 409, got ${duplicate.status}`,
		);
	}

	const response = await fetch(editionUrl(ctx.baseUrl, ctx.pair));
	if (response.status !== 200) {
		throw new Error(`edition read after duplicate trigger returned ${response.status}`);
	}
	const servedAgain = await response.text();
	if (servedAgain !== firstServedEditionBody) {
		throw new Error("edition served after duplicate trigger is not byte-identical");
	}
	console.log("walk: duplicate trigger served a byte-identical edition");
}

export const walkPhase: WalkPhase = { name: "idempotency", run };
