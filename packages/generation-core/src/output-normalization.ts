function normalizeDecodedString(value: string): string {
	return value.replace(/\r\n/g, "\n");
}

export function normalizeDecodedOutputStrings(value: unknown): unknown {
	if (typeof value === "string") return normalizeDecodedString(value);
	if (Array.isArray(value)) return value.map((entry) => normalizeDecodedOutputStrings(entry));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, normalizeDecodedOutputStrings(entry)]),
	);
}
