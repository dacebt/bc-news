import type { GenerationRunParams } from "@bc-news/contracts";

export interface WalkState {
	firstServedEditionBody?: string;
}

export interface WalkContext {
	baseUrl: string;
	pair: GenerationRunParams;
	unpublishedPair: GenerationRunParams;
	state: WalkState;
}

export interface WalkPhase {
	name: string;
	run: (ctx: WalkContext) => Promise<void>;
}
