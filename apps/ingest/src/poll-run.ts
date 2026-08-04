import { resolvePollConfig, type PollEnv } from "./config";
import { pollChatMessages, type PollResult } from "./poller";

export interface PollRunEnv extends PollEnv {
	DB: D1Database;
}

export async function runPoll(env: PollRunEnv): Promise<PollResult> {
	const config = resolvePollConfig(env);
	return pollChatMessages(env.DB, config);
}
