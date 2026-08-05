function repairedJsonStringValuesMatchObservedProse(
	candidate: string,
	repairOffsets: readonly number[],
): boolean {
	const repairOffsetsByStringStart = new Map<number, number[]>();
	const objectKeyStringStarts = new Set<number>();
	let assignedRepairCount = 0;

	for (let index = 0; index < candidate.length; index += 1) {
		if (candidate[index] !== '"') continue;
		const stringStart = index;
		index += 1;
		while (index < candidate.length && candidate[index] !== '"') {
			if (candidate[index] === "\\") index += 1;
			index += 1;
		}
		if (index >= candidate.length) return false;

		let nextToken = index + 1;
		while (nextToken < candidate.length && /[ \t\r\n]/u.test(candidate[nextToken]!)) {
			nextToken += 1;
		}
		if (candidate[nextToken] === ":") objectKeyStringStarts.add(stringStart);

		for (const repairOffset of repairOffsets) {
			if (repairOffset <= stringStart || repairOffset >= index) continue;
			if (candidate[repairOffset] !== "\\" || candidate[repairOffset + 1] !== '"') return false;
			const stringRepairOffsets = repairOffsetsByStringStart.get(stringStart) ?? [];
			stringRepairOffsets.push(repairOffset);
			repairOffsetsByStringStart.set(stringStart, stringRepairOffsets);
			assignedRepairCount += 1;
		}
	}

	if (assignedRepairCount !== repairOffsets.length) return false;
	for (const [stringStart, stringRepairOffsets] of repairOffsetsByStringStart) {
		stringRepairOffsets.sort((left, right) => left - right);
		const repairCount = stringRepairOffsets.length;
		if (objectKeyStringStarts.has(stringStart) || repairCount < 2 || repairCount % 2 !== 0) {
			return false;
		}
		for (let index = 0; index < repairCount; index += 2) {
			const openingOffset = stringRepairOffsets[index]!;
			const closingOffset = stringRepairOffsets[index + 1]!;
			const quotedProse = candidate.slice(openingOffset + 2, closingOffset);
			const proseTokens = quotedProse.trim().split(/[ \t\r\n]+/u);
			if (
				!/[ \t\r\n]/u.test(candidate[openingOffset - 1] ?? "") ||
				!/[ \t\r\n]/u.test(candidate[closingOffset + 2] ?? "") ||
				proseTokens.length < 2 ||
				!proseTokens.every((token) => /[\p{L}\p{N}]/u.test(token))
			) {
				return false;
			}
		}
	}
	return repairOffsetsByStringStart.size > 0;
}

export function normalizeLmStudioJsonQuotes(original: string): string {
	let candidate = original;
	const repairOffsets: number[] = [];

	for (;;) {
		try {
			JSON.parse(candidate);
			return repairOffsets.length > 0 && repairedJsonStringValuesMatchObservedProse(candidate, repairOffsets)
				? candidate
				: original;
		} catch (cause) {
			if (repairOffsets.length >= 64) return original;
			const positionMatch = /at position (\d+)/u.exec(cause instanceof Error ? cause.message : "");
			if (positionMatch === null) return original;
			const position = Number(positionMatch[1]);
			if (!Number.isSafeInteger(position) || position < 0 || position >= candidate.length) return original;

			let quoteOffset = position - 1;
			while (quoteOffset >= 0 && /[ \t\r\n]/u.test(candidate[quoteOffset]!)) quoteOffset -= 1;
			if (quoteOffset < 0 || candidate[quoteOffset] !== '"') return original;
			let precedingBackslashes = 0;
			for (let index = quoteOffset - 1; index >= 0 && candidate[index] === "\\"; index -= 1) {
				precedingBackslashes += 1;
			}
			if (precedingBackslashes % 2 !== 0) return original;

			for (let index = 0; index < repairOffsets.length; index += 1) {
				if (repairOffsets[index]! >= quoteOffset) repairOffsets[index]! += 1;
			}
			repairOffsets.push(quoteOffset);
			candidate = `${candidate.slice(0, quoteOffset)}\\${candidate.slice(quoteOffset)}`;
		}
	}
}
