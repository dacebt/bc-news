import { NonRetryableError } from "cloudflare:workflows";
import { ZodError } from "zod";
import {
	DateDerivationError,
	EditorialOutputContractError,
	EvidenceContractError,
} from "@bc-news/generation-core";
import { FixtureEvidenceMismatchError, RecordedModelProviderError } from "@bc-news/fixtures";
import { LmStudioDeterministicError } from "./adapters/lmstudio-model-provider";
import { GenerationConfigError } from "./config-error";

const DETERMINISTIC_FAILURES = [
	ZodError,
	DateDerivationError,
	EditorialOutputContractError,
	EvidenceContractError,
	FixtureEvidenceMismatchError,
	RecordedModelProviderError,
	LmStudioDeterministicError,
	GenerationConfigError,
] as const;

function hasCode(error: object): error is { code: string } {
	return "code" in error && typeof error.code === "string";
}

/**
 * Contract, config, and derivation failures are deterministic: a retry replays
 * the identical inputs and fails identically, so retrying one is pure waste and,
 * once a live model provider exists, uncontrolled model spend. They rethrow as
 * NonRetryableError; every other failure rethrows untouched and stays retryable.
 */
export async function failNonRetryablyOnDeterministicErrors<T>(
	work: () => Promise<T> | T,
): Promise<T> {
	try {
		return await work();
	} catch (error) {
		for (const deterministicFailure of DETERMINISTIC_FAILURES) {
			if (error instanceof deterministicFailure) {
				throw new NonRetryableError(error.message, hasCode(error) ? error.code : error.name);
			}
		}
		throw error;
	}
}
