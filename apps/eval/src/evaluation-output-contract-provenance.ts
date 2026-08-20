import { PRODUCTION_STEP_OUTPUT_CONTRACTS } from "@bc-news/model-adapters";
import { CURRENT_PRODUCTION_MODEL_STEPS } from "./current-production-steps";
import { canonical, sha256Json } from "./evaluation-artifact-schemas";

export function evaluationOutputContractProvenance() {
	return CURRENT_PRODUCTION_MODEL_STEPS.map((productionStep) => {
		const canonicalSchema = canonical(PRODUCTION_STEP_OUTPUT_CONTRACTS[productionStep].schema);
		return {
			production_step: productionStep,
			canonical_schema: canonicalSchema,
			schema_sha256: sha256Json(canonicalSchema),
		};
	});
}
