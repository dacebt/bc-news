import { readFile } from "node:fs/promises";
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSingleWranglerCron(source: string, configPath: string): string {
	const parsed = parseConfigFileTextToJson(configPath, source);
	if (parsed.error !== undefined) {
		throw new Error(
			`Wrangler config ${configPath} is invalid JSONC: ${flattenDiagnosticMessageText(parsed.error.messageText, "\n")}`,
		);
	}
	if (!isRecord(parsed.config) || !isRecord(parsed.config["triggers"])) {
		throw new Error(`Wrangler config ${configPath} must define a root triggers object`);
	}
	const crons = parsed.config["triggers"]["crons"];
	if (
		!Array.isArray(crons) ||
		crons.length !== 1 ||
		typeof crons[0] !== "string" ||
		crons[0].trim().length === 0
	) {
		throw new Error(
			`Wrangler config ${configPath} must define triggers.crons as exactly one non-empty string`,
		);
	}
	return crons[0];
}

export async function readSingleWranglerCron(configPath: string): Promise<string> {
	const source = await readFile(configPath, "utf8");
	return parseSingleWranglerCron(source, configPath);
}
