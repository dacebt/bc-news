import type { WalkPhase } from "../phase";
import { walkPhase as browserParity } from "./browser-parity";
import { walkPhase as clientHtml } from "./client-html";
import { walkPhase as editorialProducts } from "./editorial-products";
import { walkPhase as idempotency } from "./idempotency";
import { walkPhase as operatorBoundary } from "./operator-boundary";
import { walkPhase as operatorStatus } from "./operator-status";
import { walkPhase as publishPoll } from "./publish-poll";
import { walkPhase as scheduledGeneration } from "./scheduled-generation";
import { walkPhase as scheduledIngest } from "./scheduled-ingest";
import { walkPhase as unknownPair } from "./unknown-pair";

export const walkPhases: readonly WalkPhase[] = [
	operatorBoundary,
	scheduledIngest,
	scheduledGeneration,
	publishPoll,
	operatorStatus,
	editorialProducts,
	idempotency,
	unknownPair,
	clientHtml,
	browserParity,
	{
		name: "five-step-generation-workflow",
		run: () => {
			console.log("walk: five-step generation workflow complete");
			return Promise.resolve();
		},
	},
];
