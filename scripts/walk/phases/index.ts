import type { WalkPhase } from "../phase";
import { walkPhase as announcements } from "./announcements";
import { walkPhase as browserParity } from "./browser-parity";
import { walkPhase as canonicalEval } from "./canonical-eval";
import { walkPhase as clientHtml } from "./client-html";
import { walkPhase as idempotency } from "./idempotency";
import { walkPhase as packaging } from "./packaging";
import { walkPhase as operatorStatus } from "./operator-status";
import { walkPhase as publishPoll } from "./publish-poll";
import { walkPhase as scheduledGeneration } from "./scheduled-generation";
import { walkPhase as scheduledIngest } from "./scheduled-ingest";
import { walkPhase as unknownPair } from "./unknown-pair";

export const walkPhases: readonly WalkPhase[] = [
	scheduledIngest,
	scheduledGeneration,
	publishPoll,
	operatorStatus,
	announcements,
	packaging,
	idempotency,
	unknownPair,
	clientHtml,
	canonicalEval,
	browserParity,
];
