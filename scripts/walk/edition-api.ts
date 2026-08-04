import type { GenerationRunParams } from "@bc-news/contracts";
import type { WalkContext } from "./phase";

export interface GenerationRunTriggerResult {
	status: number;
	body: string;
}

export function editionUrl(baseUrl: string, pair: GenerationRunParams): string {
	return `${baseUrl}/api/edition?active_region_id=${pair.active_region_id}&publication_date=${pair.publication_date}`;
}

export async function triggerGenerationRun(ctx: WalkContext): Promise<GenerationRunTriggerResult> {
	const response = await fetch(`${ctx.baseUrl}/generation-run`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(ctx.pair),
	});
	return { status: response.status, body: await response.text() };
}
