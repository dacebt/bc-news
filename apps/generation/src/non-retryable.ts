import { NonRetryableError } from "cloudflare:workflows";
import { ZodError } from "zod";
import { DateDerivationError, EditorialOutputContractError } from "@bc-news/generation-core";
import { FixtureEvidenceMismatchError, RecordedModelProviderError } from "@bc-news/fixtures";
import { GenerationConfigError } from "./config";

const DETERMINISTIC_FAILURES = [
	ZodError,
	DateDerivationError,
	EditorialOutputContractError,
	FixtureEvidenceMismatchError,
	RecordedModelProviderError,
	GenerationConfigError,
] as const;

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
				throw new NonRetryableError(error.message, error.name);
			}
		}
		throw error;
	}
}
