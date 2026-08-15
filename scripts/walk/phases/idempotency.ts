import type { WalkContext, WalkPhase } from "../phase";
import { editionUrl } from "../edition-api";
import { dispatchScheduledEvent } from "../scheduled-event";
import { fetchGenerationRunStatus } from "../generation-run-status";
import { assertRecordedGenerationEvidenceUnchanged } from "../recorded-response";

async function run(ctx: WalkContext): Promise<void> {
	if (ctx.state.firstServedEditionBody === undefined) {
		throw new Error(
			"idempotency phase requires ctx.state.firstServedEditionBody from the publish-poll phase, but it is absent",
		);
	}
	const firstServedEditionBody = ctx.state.firstServedEditionBody;
	if (ctx.state.firstGenerationRunEvidence === undefined) {
		throw new Error("idempotency phase requires operator-status generation-run evidence");
	}
	const firstGenerationRunEvidence = ctx.state.firstGenerationRunEvidence;

	const duplicate = await dispatchScheduledEvent(ctx.baseUrl, ctx.generationCron, ctx.scheduledTime);
	console.log(
		`walk: repeated scheduled generation signal recorded: ${duplicate.status} ${duplicate.body}`,
	);
	if (duplicate.status !== 200) {
		throw new Error(
			`repeated scheduled generation expected idempotent 200, got ${duplicate.status}`,
		);
	}

	const response = await fetch(editionUrl(ctx.baseUrl, ctx.pair));
	if (response.status !== 200) {
		throw new Error(`edition read after duplicate trigger returned ${response.status}`);
	}
	const servedAgain = await response.text();
	if (servedAgain !== firstServedEditionBody) {
		throw new Error("edition served after repeated scheduled generation is not byte-identical");
	}
	const status = await fetchGenerationRunStatus(ctx.baseUrl, ctx.pair, ctx.operatorToken);
	assertRecordedGenerationEvidenceUnchanged(firstGenerationRunEvidence, status);
	console.log("walk: repeated scheduled generation served the first edition byte-identically");
}

export const walkPhase: WalkPhase = { name: "idempotency", run };
