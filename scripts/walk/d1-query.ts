import { spawn } from "node:child_process";

interface D1QueryEnvelope {
	results?: Array<Record<string, unknown>>;
	success?: boolean;
}

function runD1Query(cwd: string, persistDir: string, sql: string): Promise<readonly D1QueryEnvelope[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"pnpm",
			[
				"exec",
				"wrangler",
				"d1",
				"execute",
				"bc-news-editions",
				"--local",
				"--persist-to",
				persistDir,
				"--command",
				sql,
				"--json",
			],
			{ cwd, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code !== 0) {
				reject(new Error(`local D1 query exited with ${String(code)}: ${stderr || stdout}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as D1QueryEnvelope[]);
			} catch (error) {
				reject(new Error(`local D1 query returned invalid JSON: ${stdout}`, { cause: error }));
			}
		});
	});
}

export async function chatMessageCount(cwd: string, persistDir: string): Promise<number> {
	const envelopes = await runD1Query(
		cwd,
		persistDir,
		"SELECT COUNT(*) AS row_count FROM chat_messages",
	);
	const rowCount = envelopes[0]?.results?.[0]?.["row_count"];
	if (envelopes[0]?.success !== true || typeof rowCount !== "number") {
		throw new Error(`local D1 count result has an unexpected shape: ${JSON.stringify(envelopes)}`);
	}
	return rowCount;
}
