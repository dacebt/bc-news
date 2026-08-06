import { join } from "node:path";
import { verifyCanonicalEvalReplay } from "../../../apps/eval/src/canonical-walk-verifier";
import { verifyRecordReplayCompare } from "../../../apps/eval/src/record-loopback-verifier";
import { verifyEvaluationBenchmarkContinuation } from "../../../apps/eval/src/evaluation-benchmark-verifier";
import type { WalkContext, WalkPhase } from "../phase";

async function run(ctx: WalkContext): Promise<void> {
	await verifyCanonicalEvalReplay(join(ctx.persistDir, "eval-results"));
	await verifyRecordReplayCompare(join(ctx.persistDir, "record-replay-compare"));
	await verifyEvaluationBenchmarkContinuation(join(ctx.persistDir, "evaluation-benchmark-continuation"));
}

export const walkPhase: WalkPhase = { name: "canonical-eval", run };
