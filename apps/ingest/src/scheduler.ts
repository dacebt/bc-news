import { runPoll, type PollRunEnv } from "./poll-run";
import type { PollResult } from "./poller";

type PollRunner = (env: PollRunEnv) => Promise<PollResult>;

export async function schedulePoll(
	env: PollRunEnv,
	runner: PollRunner = runPoll,
): Promise<void> {
	const result = await runner(env);
	if (result.outcome !== "complete") {
		throw new Error(
			`Scheduled ingest poll ${result.outcome} during ${result.failure.phase}: ${result.failure.message}`,
		);
	}
}
