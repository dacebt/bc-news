import type { GenerationRunParams } from "@bc-news/contracts";
import type { Browser } from "playwright-core";

export interface WalkState {
	firstServedEditionBody?: string;
	firstModelUsageBody?: string;
}

export interface WalkContext {
	baseUrl: string;
	ingestBaseUrl: string;
	generationDir: string;
	persistDir: string;
	scheduledTime: number;
	generationCron: string;
	ingestCron: string;
	pair: GenerationRunParams;
	unpublishedPair: GenerationRunParams;
	state: WalkState;
	registerBrowser: (browser: Browser) => void;
}

export interface WalkPhase {
	name: string;
	run: (ctx: WalkContext) => Promise<void>;
}
