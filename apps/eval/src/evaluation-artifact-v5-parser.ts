import { z } from "zod";
import type { EvaluationFinding } from "./evaluation-artifact-schemas";
import {
	V1AnnouncementsCopyeditOutputSchema,
	V1AnnouncementsWriterOutputSchema,
	V1MainStoryProductSchema,
	type V1ProductionModelStep,
	type V1WriterOutput,
} from "./evaluation-artifact-v1-contracts";
import {
	attachV5AnnouncementIds,
	v5AnnouncementsPreservationDiagnostics,
	v5MainStoryPreservationDiagnostics,
} from "./evaluation-artifact-v5-diagnostics";

export class V5EditorialOutputError extends Error {
	constructor(
		readonly productionStep: V1ProductionModelStep,
		readonly code: "invalid_json" | "contract_mismatch",
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "V5EditorialOutputError";
	}
}

function parseJson(step: V1ProductionModelStep, text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new V5EditorialOutputError(step, "invalid_json", `${step} model output is not valid JSON`, { cause });
	}
}

function parseSchema<T>(step: V1ProductionModelStep, text: string, schema: z.ZodType<T>): T {
	const result = schema.safeParse(parseJson(step, text));
	if (!result.success) throw new V5EditorialOutputError(step, "contract_mismatch", `${step} model output does not match its strict contract: ${result.error.message}`);
	return result.data;
}

export interface V5CompletionParse {
	readonly output: Record<string, unknown>;
	readonly diagnostics: readonly EvaluationFinding[];
}

export function parseV5Completion(
	step: V1ProductionModelStep,
	text: string,
	writerOutput?: V1WriterOutput,
): V5CompletionParse {
	if (step === "main_story_write") return { output: parseSchema(step, text, V1MainStoryProductSchema), diagnostics: [] };
	if (step === "announcements_write") return { output: parseSchema(step, text, V1AnnouncementsWriterOutputSchema), diagnostics: [] };
	if (step === "main_story_copyedit") {
		const draft = V1MainStoryProductSchema.parse(writerOutput);
		const product = parseSchema(step, text, V1MainStoryProductSchema);
		return { output: product, diagnostics: v5MainStoryPreservationDiagnostics(draft, product) };
	}
	const draft = attachV5AnnouncementIds(V1AnnouncementsWriterOutputSchema.parse(writerOutput));
	const edited = parseSchema(step, text, V1AnnouncementsCopyeditOutputSchema);
	const output = V1AnnouncementsWriterOutputSchema.parse({
		announcements: edited.announcements.map(({ title, summary }) => ({ title, summary })),
	});
	return { output, diagnostics: v5AnnouncementsPreservationDiagnostics(draft, edited) };
}
