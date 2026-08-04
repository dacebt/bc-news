import type { WalkPhase } from "../phase";
import { walkPhase as announcements } from "./announcements";
import { walkPhase as clientHtml } from "./client-html";
import { walkPhase as idempotency } from "./idempotency";
import { walkPhase as ingestPoll } from "./ingest-poll";
import { walkPhase as packaging } from "./packaging";
import { walkPhase as publishPoll } from "./publish-poll";
import { walkPhase as triggerGenerationRun } from "./trigger-generation-run";
import { walkPhase as unknownPair } from "./unknown-pair";

export const walkPhases: readonly WalkPhase[] = [
	ingestPoll,
	triggerGenerationRun,
	publishPoll,
	announcements,
	packaging,
	idempotency,
	unknownPair,
	clientHtml,
];
