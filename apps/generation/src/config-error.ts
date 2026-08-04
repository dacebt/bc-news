export class GenerationConfigError extends Error {
	readonly code = "invalid_generation_config";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "GenerationConfigError";
	}
}
