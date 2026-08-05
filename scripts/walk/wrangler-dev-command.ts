export const WALK_RECORDED_MODEL_CONFIG = JSON.stringify({
	main_story: { adapter: "recorded" },
	announcements: { adapter: "recorded" },
	packaging: { adapter: "recorded" },
});

export function wranglerDevArguments(input: {
	readonly port: number;
	readonly persistDir: string;
	readonly vars: Readonly<Record<string, string>>;
}): string[] {
	const varArgs = Object.entries(input.vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]);
	return [
		"exec",
		"wrangler",
		"dev",
		"--port",
		String(input.port),
		"--persist-to",
		input.persistDir,
		// The generation and ingest dev processes run together. Port 0 gives each
		// inspector an independent ephemeral port instead of competing for 9229.
		"--inspector-port",
		"0",
		...varArgs,
	];
}

export function walkGenerationWranglerDevArguments(input: {
	readonly port: number;
	readonly persistDir: string;
}): string[] {
	return wranglerDevArguments({
		...input,
		vars: { MODEL_CONFIG: WALK_RECORDED_MODEL_CONFIG },
	});
}
