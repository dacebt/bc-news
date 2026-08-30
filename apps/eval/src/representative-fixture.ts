import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = join(APP_DIRECTORY, "..", "..");
export const REPRESENTATIVE_FIXTURE_FILENAME = "active-region-7_2026-01-24.json";

export const REPRESENTATIVE_FIXTURE_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"evidence",
	REPRESENTATIVE_FIXTURE_FILENAME,
);

export const RECORDED_OUTPUT_FIXTURE_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"evidence",
	"game-reference-links.json",
);
