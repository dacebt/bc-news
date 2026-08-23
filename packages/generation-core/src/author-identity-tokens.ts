import type { PreparedEvidence } from "./prepared-evidence";

const AUTHOR_IDENTITY_TOKEN_PATTERN = /\[\[AUTHOR_(\d{3,})\]\]/gu;
const BOLD_AUTHOR_IDENTITY_TOKEN_PATTERN = /(\*\*)(\[\[AUTHOR_\d{3,}\]\])(\*\*)/gu;
const UNRESOLVED_AUTHOR_IDENTITY_PATTERN = /\[\[[^\]\r\n]*AUTHOR[^\]\r\n]*\]\]|\bAUTHOR_\d+\b/iu;
const MARKDOWN_CONTROL_CHARACTER_PATTERN = /[\\`*_[\]<>]/gu;
const LEADING_ASTERISKS_PATTERN = /^\*+/u;
const TRAILING_ASTERISKS_PATTERN = /\*+$/u;

interface AuthorIdentityEntry {
	readonly authorId: string;
	readonly displayName: string;
	readonly token: string;
}

export interface AuthorIdentityLedger {
	readonly entries: readonly AuthorIdentityEntry[];
	readonly byAuthorId: ReadonlyMap<string, AuthorIdentityEntry>;
	readonly byOrdinal: ReadonlyMap<string, AuthorIdentityEntry>;
}

export type AuthorIdentityRendering = "plain" | "bold";

function escapeMarkdownControlCharacters(value: string): string {
	return value.replace(MARKDOWN_CONTROL_CHARACTER_PATTERN, "\\$&");
}

export function buildAuthorIdentityLedger(
	preparedEvidence: PreparedEvidence,
): AuthorIdentityLedger {
	const latestDisplayNameByAuthorId = new Map<string, string>();
	for (const message of preparedEvidence.messages) {
		if (message.author_name !== "") {
			latestDisplayNameByAuthorId.set(message.author_id, message.author_name);
		}
	}

	const entries: AuthorIdentityEntry[] = [];
	const byAuthorId = new Map<string, AuthorIdentityEntry>();
	const byOrdinal = new Map<string, AuthorIdentityEntry>();
	for (const message of preparedEvidence.messages) {
		if (byAuthorId.has(message.author_id)) continue;
		const ordinal = String(entries.length + 1).padStart(3, "0");
		const entry: AuthorIdentityEntry = {
			authorId: message.author_id,
			displayName:
				latestDisplayNameByAuthorId.get(message.author_id) ??
				`user_${message.author_id}`,
			token: `[[AUTHOR_${ordinal}]]`,
		};
		entries.push(entry);
		byAuthorId.set(entry.authorId, entry);
		byOrdinal.set(ordinal, entry);
	}

	return { entries, byAuthorId, byOrdinal };
}

export function authorIdentityToken(
	ledger: AuthorIdentityLedger,
	authorId: string,
): string {
	const entry = ledger.byAuthorId.get(authorId);
	if (entry === undefined) {
		throw new Error(`Prepared evidence author identity is not in its token ledger: ${authorId}`);
	}
	return entry.token;
}

export function resolveAuthorIdentityTokens(
	value: string,
	ledger: AuthorIdentityLedger,
	rendering: AuthorIdentityRendering,
): string {
	for (const match of value.matchAll(AUTHOR_IDENTITY_TOKEN_PATTERN)) {
		const start = match.index;
		if (start === undefined) {
			throw new Error("Author identity token position is unavailable");
		}
		const end = start + match[0].length;
		const leadingAsterisks = value.slice(0, start).match(TRAILING_ASTERISKS_PATTERN)?.[0].length ?? 0;
		const trailingAsterisks = value.slice(end).match(LEADING_ASTERISKS_PATTERN)?.[0].length ?? 0;
		const isBare = leadingAsterisks === 0 && trailingAsterisks === 0;
		const isBalancedBold = leadingAsterisks === 2 && trailingAsterisks === 2;
		if (!isBare && !isBalancedBold) {
			throw new Error("Author identity tokens may use only balanced bold markdown");
		}
	}

	const normalized = value.replace(BOLD_AUTHOR_IDENTITY_TOKEN_PATTERN, "$2");
	const resolved = normalized.replace(
		AUTHOR_IDENTITY_TOKEN_PATTERN,
		(_token, ordinal: string) => {
			const entry = ledger.byOrdinal.get(ordinal);
			if (entry === undefined) {
				throw new Error(`Unknown author identity token: [[AUTHOR_${ordinal}]]`);
			}
			return rendering === "bold"
				? `**${escapeMarkdownControlCharacters(entry.displayName)}**`
				: entry.displayName;
		},
	);
	if (UNRESOLVED_AUTHOR_IDENTITY_PATTERN.test(resolved)) {
		throw new Error("Malformed or unresolved author identity token");
	}
	return resolved;
}
