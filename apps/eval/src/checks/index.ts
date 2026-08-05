import type {
	AnnouncementsOutput,
	EditorialCapability,
	MainStoryOutput,
	PackagingOutput,
	PreparedEvidence,
} from "@bc-news/generation-core";
import { checkResult, type NamedCheckResult } from "./common";
import { formattingCheck } from "./formatting";
import { groundingCheck } from "./grounding";
import { injectionCheck } from "./injection";
import { mainStoryStageSpecificCheck } from "./main-story-checks";

export interface CheckResult {
	readonly name: "injection" | "grounding" | "schema" | "formatting" | "stage_specific";
	readonly passed: boolean;
	readonly detail: string;
}

export type RetainedCapabilityOutput = MainStoryOutput | AnnouncementsOutput | PackagingRetainedOutput;

export interface PackagingRetainedOutput extends PackagingOutput {
	readonly active_region_id: string;
	readonly publication_date: string;
	readonly announcements: AnnouncementsOutput["announcements"];
	readonly main_story: MainStoryOutput["main_story"];
}

export type EvalCheckRequest = {
	readonly editorialCapability: EditorialCapability;
	readonly rawText: string;
	readonly output: RetainedCapabilityOutput;
	readonly preparedEvidence: PreparedEvidence;
	readonly mainStoryOutput?: MainStoryOutput;
	readonly announcementsOutput?: AnnouncementsOutput;
};

function textFields(output: RetainedCapabilityOutput): string[] {
	if ("main_story" in output && !(`active_region_id` in output)) {
		return [output.main_story.headline, output.main_story.lede, output.main_story.body];
	}
	if ("announcements" in output && !(`active_region_id` in output)) {
		return output.announcements.flatMap((announcement) => [announcement.title, announcement.summary]);
	}
	return [output.title, output.subtitle];
}

function genericFormattingCheck(output: RetainedCapabilityOutput): NamedCheckResult<"formatting"> {
	const text = textFields(output).join("\n");
	const issues: string[] = [];
	if (text.includes("—")) issues.push("Contains an em dash");
	if (/^#{1,6}\s/m.test(text)) issues.push("Contains markdown headers");
	if (text.includes("```")) issues.push("Contains code blocks");
	return checkResult("formatting", issues, "Capability formatting passed");
}

function genericGroundingCheck(
	output: RetainedCapabilityOutput,
	preparedEvidence: PreparedEvidence,
): NamedCheckResult<"grounding"> {
	const source = preparedEvidence.messages.map((message) => `${message.author_name} ${message.text}`).join(" ").toLowerCase();
	const issues: string[] = [];
	for (const match of textFields(output).join(" ").matchAll(/\*\*([^*]+)\*\*/g)) {
		const marked = (match[1] ?? "").trim().toLowerCase();
		if (marked.length > 0 && !source.includes(marked)) issues.push(`Ungrounded marked text: ${marked}`);
	}
	return checkResult("grounding", issues, "Marked player names are grounded");
}

function announcementsStageSpecificCheck(output: AnnouncementsOutput): NamedCheckResult<"stage_specific"> {
	const keys = output.announcements.map((announcement) => `${announcement.title}\u0000${announcement.summary}`);
	const issues = keys.length === new Set(keys).size ? [] : ["Duplicate announcement entries detected"];
	return checkResult("stage_specific", issues, `Announcements contain ${keys.length} distinct entries`);
}

function packagingStageSpecificCheck(request: EvalCheckRequest): NamedCheckResult<"stage_specific"> {
	const issues: string[] = [];
	if (!("active_region_id" in request.output)) issues.push("Packaging retained output is not a composed edition");
	else {
		if (request.output.active_region_id !== request.preparedEvidence.active_region_id) issues.push("Region identity changed");
		if (request.output.publication_date !== request.preparedEvidence.publication_date) issues.push("Publication date changed");
		if (JSON.stringify(request.output.main_story) !== JSON.stringify(request.mainStoryOutput?.main_story)) {
			issues.push("Main story was not structurally preserved");
		}
		if (JSON.stringify(request.output.announcements) !== JSON.stringify(request.announcementsOutput?.announcements)) {
			issues.push("Announcements were not structurally preserved");
		}
		if (Object.hasOwn(request.output, "meta") || Object.hasOwn(request.output, "generated_at")) {
			issues.push("Retained packaging output contains runtime metadata");
		}
	}
	return checkResult("stage_specific", issues, "Packaging preserves parsed outputs and identity exactly");
}

export function runEvalChecks(request: EvalCheckRequest): readonly CheckResult[] {
	const grounding = request.editorialCapability === "main_story"
		? groundingCheck(request.output as MainStoryOutput, request.preparedEvidence.messages)
		: genericGroundingCheck(request.output, request.preparedEvidence);
	const formatting = request.editorialCapability === "main_story"
		? formattingCheck(request.output as MainStoryOutput, request.preparedEvidence.messages)
		: genericFormattingCheck(request.output);
	const stageSpecific = request.editorialCapability === "main_story"
		? mainStoryStageSpecificCheck(request.output as MainStoryOutput)
		: request.editorialCapability === "announcements"
			? announcementsStageSpecificCheck(request.output as AnnouncementsOutput)
			: packagingStageSpecificCheck(request);
	return [
		injectionCheck(request.rawText, textFields(request.output).join("\n")),
		grounding,
		{ name: "schema", passed: true, detail: "Schema validation passed prior to check dispatch" },
		formatting,
		stageSpecific,
	];
}
