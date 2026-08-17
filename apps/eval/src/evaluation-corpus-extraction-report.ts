import type { ProductionCorpusExtractionResult } from "./evaluation-corpus-extraction";

export function formatProductionCorpusExtractionReport(result: ProductionCorpusExtractionResult): string {
	return [
		`Production corpus extraction: ${result.selectionId}`,
		`Workspace: ${result.workspacePath}`,
		`Messages: raw=${result.totalRawCount} prepared=${result.totalPreparedCount}`,
		...result.cases.map((entry) => [
			`${entry.ordinal}. ${entry.id}`,
			`region=${entry.activeRegionId}`,
			`raw=${entry.rawCount}`,
			`prepared=${entry.preparedCount}`,
		].join(" | ")),
	].join("\n");
}
