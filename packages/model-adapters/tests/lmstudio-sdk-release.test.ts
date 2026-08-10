import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { LM_STUDIO_SDK_RELEASE } from "../src/index";

test("pins the exported LM Studio SDK release to installed package metadata", async () => {
	const require = createRequire(import.meta.url);
	let directory = dirname(require.resolve("@lmstudio/sdk"));
	for (;;) {
		const packagePath = join(directory, "package.json");
		try {
			const metadata = JSON.parse(await readFile(packagePath, "utf8")) as { name?: unknown; version?: unknown };
			if (metadata.name === "@lmstudio/sdk") {
				expect(metadata.version).toBe(LM_STUDIO_SDK_RELEASE);
				expect(LM_STUDIO_SDK_RELEASE).toBe("1.5.0");
				return;
			}
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const parent = dirname(directory);
		if (parent === directory) throw new Error("Could not resolve @lmstudio/sdk package metadata");
		directory = parent;
	}
});
