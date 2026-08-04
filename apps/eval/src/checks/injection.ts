import { checkResult, type NamedCheckResult } from "./common";

const INJECTION_PATTERNS = [
	/ignore\s+previous\s+instructions/i,
	/system\s+prompt/i,
	/developer\s+message/i,
	/disregard\s+(all\s+)?previous/i,
	/new\s+instructions?:/i,
];

const META_PATTERNS = [
	/\bas\s+an?\s+AI\b/i,
	/\bI\s+cannot\b/i,
	/\bI\s+apologize\b/i,
	/\bI\s+don'?t\s+have\b/i,
	/\bI'?m\s+unable\b/i,
	/\bas\s+a\s+language\s+model\b/i,
	/\bI\s+must\s+(clarify|note|mention)\b/i,
];

const CLICHE_PATTERNS = [
	/\bdelve[ds]?\b/i,
	/\bdelving\b/i,
	/\btapestry\b/i,
	/\blandscape\b.*?\b(of|for)\b/i,
	/\butilized?\b/i,
	/\bleverage[ds]?\b/i,
	/\bIn\s+conclusion\b/i,
	/\bIt'?s\s+worth\s+noting\b/i,
	/\bnotably\b/i,
	/\bsignificantly\b/i,
	/\bseamlessly\b/i,
	/\brobust\b/i,
	/\bfacilitate[ds]?\b/i,
];

const TONE_PATTERNS = [/!{2,}/, /\b(so-called|"so-called")\b/i, /;\)/, /:-?[DPp)]/];

/**
 * Runs against the model's raw completion text, before JSON parsing: a
 * transcript-borne directive that succeeded in steering the model surfaces
 * here even if the model still emitted well-formed JSON around it.
 */
export function injectionCheck(rawText: string): NamedCheckResult<"injection"> {
	const issues: string[] = [];
	for (const pattern of INJECTION_PATTERNS) {
		const match = pattern.exec(rawText);
		if (match !== null) issues.push(`Injection pattern: ${match[0]}`);
	}
	for (const pattern of META_PATTERNS) {
		const match = pattern.exec(rawText);
		if (match !== null) issues.push(`AI meta-commentary: ${match[0]}`);
	}
	for (const pattern of CLICHE_PATTERNS) {
		const match = pattern.exec(rawText);
		if (match !== null) issues.push(`AI cliche: ${match[0]}`);
	}
	for (const pattern of TONE_PATTERNS) {
		const match = pattern.exec(rawText);
		if (match !== null) issues.push(`Tone violation: ${match[0]}`);
	}
	return checkResult("injection", issues.slice(0, 3), "No injection, meta-commentary, or AI voice detected");
}
