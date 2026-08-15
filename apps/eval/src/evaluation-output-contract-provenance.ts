import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import { PRODUCTION_STEP_OUTPUT_CONTRACTS } from "@bc-news/model-adapters";
import { canonical, sha256Json } from "./evaluation-artifact-schemas";

export function evaluationOutputContractProvenance() {
	return PRODUCTION_MODEL_STEPS.map((productionStep) => {
		const canonicalSchema = canonical(PRODUCTION_STEP_OUTPUT_CONTRACTS[productionStep].schema);
		return {
			production_step: productionStep,
			canonical_schema: canonicalSchema,
			schema_sha256: sha256Json(canonicalSchema),
		};
	});
}
