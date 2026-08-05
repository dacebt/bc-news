import { afterEach, expect, it, vi } from "vitest";
import type { EditorialCapability } from "@bc-news/generation-core";
import { resolveModelProvider } from "../src/model-adapters";
import { rubricDimensionNames } from "../src/rubrics";

afterEach(() => vi.restoreAllMocks());

const localConfig = {
	adapter: "lmstudio" as const,
	model: "local-model",
	sampling: { temperature: 0.7, top_p: 0.95, top_k: 20 },
	reasoning_effort: "none" as const,
};
const environment = { LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1" };

async function capturedRequestBody(
	capability: EditorialCapability,
	role: "capability" | "judge",
): Promise<Record<string, unknown>> {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ model: "local-model", choices: [{ message: { content: '{"accepted":true}' } }] }),
	);
	const provider = resolveModelProvider(capability, localConfig, role, environment);
	await provider.complete({ editorialCapability: capability, system: "system", user: "user" });
	const body = fetchCall.mock.calls[0]?.[1]?.body;
	if (typeof body !== "string") throw new Error("Expected request body to be JSON text");
	return JSON.parse(body) as Record<string, unknown>;
}

function expectInlineStrictObjectSchemas(schema: unknown): void {
	expect(JSON.stringify(schema)).not.toMatch(/\$(?:ref|defs)/u);
	const visit = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			for (const entry of candidate) visit(entry);
			return;
		}
		if (candidate === null || typeof candidate !== "object") return;
		const node = candidate as Record<string, unknown>;
		if (node.type === "object" && "properties" in node) {
			expect(node.additionalProperties).toBe(false);
		}
		for (const value of Object.values(node)) visit(value);
	};
	visit(schema);
}

it.each([
	["main_story", "main_story_output", "main_story"],
	["announcements", "announcements_output", "announcements"],
	["packaging", "packaging_output", "title"],
] as const)("sends the %s capability contract to LM Studio", async (capability, name, rootProperty) => {
	const body = await capturedRequestBody(capability, "capability");
	const responseFormat = body.response_format as {
		type: string;
		json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
	};

	expect(body).toMatchObject({
		temperature: 0.7,
		top_p: 0.95,
		top_k: 20,
		reasoning_effort: "none",
	});
	expect(responseFormat.type).toBe("json_schema");
	expect(responseFormat.json_schema).toMatchObject({ name, strict: true });
	expect(responseFormat.json_schema.schema.properties).toHaveProperty(rootProperty);
	expectInlineStrictObjectSchemas(responseFormat.json_schema.schema);
});

it.each([
	["main_story", "main_story_judge_output"],
	["announcements", "announcements_judge_output"],
	["packaging", "packaging_judge_output"],
] as const)("sends the exact %s judge contract to LM Studio", async (capability, name) => {
	const body = await capturedRequestBody(capability, "judge");
	const responseFormat = body.response_format as {
		type: string;
		json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
	};
	const schema = responseFormat.json_schema.schema;
	const scores = (schema.properties as Record<string, unknown>).scores as Record<string, unknown>;
	const expectedDimensions = rubricDimensionNames(capability);

	expect(responseFormat.type).toBe("json_schema");
	expect(responseFormat.json_schema).toMatchObject({
		name,
		strict: true,
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				scores: { type: "object", additionalProperties: false },
				reasoning: { type: "string" },
			},
		},
	});
	expect(Object.keys(scores.properties as Record<string, unknown>)).toEqual(expectedDimensions);
	expect(scores.required).toEqual(expectedDimensions);
	expectInlineStrictObjectSchemas(schema);
});
