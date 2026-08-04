import type { GenerationRunParams } from "@bc-news/contracts";

export function editionUrl(baseUrl: string, pair: GenerationRunParams): string {
	return `${baseUrl}/api/edition?active_region_id=${pair.active_region_id}&publication_date=${pair.publication_date}`;
}
