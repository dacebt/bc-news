/**
 * Every differing path between two values, not just the first. Reporting only
 * the first difference under-reports drift by construction: keys are walked in
 * sorted order, so an early field masks everything after it, and a reader is
 * told about one moved byte while other rewritten product fields go unnamed.
 */
export function allDifferences(
	left: unknown,
	right: unknown,
	ignoredTopLevelKeys: readonly string[] = [],
): string[] {
	return collectDifferences(left, right, "run", new Set(ignoredTopLevelKeys), true);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectDifferences(
	left: unknown,
	right: unknown,
	path: string,
	ignoredKeys: ReadonlySet<string>,
	atTopLevel: boolean,
): string[] {
	if (Object.is(left, right)) return [];
	if (Array.isArray(left) && Array.isArray(right)) {
		const differences: string[] = [];
		if (left.length !== right.length) differences.push(`${path}.length`);
		for (let index = 0; index < Math.min(left.length, right.length); index++) {
			differences.push(
				...collectDifferences(left[index], right[index], `${path}[${String(index)}]`, ignoredKeys, false),
			);
		}
		return differences;
	}
	if (isPlainObject(left) && isPlainObject(right)) {
		const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
		const differences: string[] = [];
		for (const key of keys) {
			if (atTopLevel && ignoredKeys.has(key)) continue;
			if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
				differences.push(`${path}.${key}`);
				continue;
			}
			differences.push(...collectDifferences(left[key], right[key], `${path}.${key}`, ignoredKeys, false));
		}
		return differences;
	}
	return [path];
}
