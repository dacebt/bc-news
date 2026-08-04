import type { MainStoryOutput, PreparedMessage } from "@bc-news/generation-core";

type CheckName = "injection" | "grounding" | "schema" | "formatting" | "stage_specific";

export interface NamedCheckResult<Name extends CheckName> {
	readonly name: Name;
	readonly passed: boolean;
	readonly detail: string;
}

export function checkResult<Name extends CheckName>(
	name: Name,
	issues: readonly string[],
	success: string,
): NamedCheckResult<Name> {
	return {
		name,
		passed: issues.length === 0,
		detail: issues.length === 0 ? success : issues.join("; "),
	};
}

export function knownPlayerNames(messages: readonly PreparedMessage[]): Set<string> {
	return new Set(
		messages
			.map((message) => message.author_name.toLowerCase())
			.filter((value) => value.length > 0),
	);
}

export function groundedAuthorNames(messages: readonly PreparedMessage[]): Set<string> {
	return new Set(
		messages
			.map((message) => message.author_name || message.author_id)
			.map((value) => value.toLowerCase())
			.filter((value) => value.length > 0),
	);
}

export function mainStoryTextFields(output: MainStoryOutput): string[] {
	return [output.main_story.headline, output.main_story.lede, output.main_story.body];
}
