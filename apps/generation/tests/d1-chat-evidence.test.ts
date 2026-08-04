import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { expect, it } from "vitest";
import { D1ChatEvidenceError, d1ChatEvidenceInput } from "../src/adapters/d1-chat-evidence";
import { failNonRetryablyOnDeterministicErrors } from "../src/non-retryable";

const EVIDENCE_DATE = "2026-04-10";
const ACTIVE_REGION_ID = "42";
const WINDOW_START_TS = Date.UTC(2026, 3, 10, 0, 0, 0, 0);
const WINDOW_END_TS = Date.UTC(2026, 3, 11, 0, 0, 0, 0);

interface ChatMessageInsert {
	entityId: string;
	regionId?: number;
	timestampTs?: number | string;
	usernameRaw?: string;
	username?: string | null;
	text?: string;
}

async function insertChatMessage({
	entityId,
	regionId = Number(ACTIVE_REGION_ID),
	timestampTs = WINDOW_START_TS,
	usernameRaw = "en/Someone",
	username = "Someone",
	text = "a message",
}: ChatMessageInsert): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO chat_messages (
			entity_id, region_id, channel_id, username_raw, username, text, timestamp_utc, timestamp_ts
		) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	)
		.bind(
			entityId,
			regionId,
			1,
			usernameRaw,
			username,
			text,
			typeof timestampTs === "number" ? new Date(timestampTs).toISOString() : "malformed",
			timestampTs,
		)
		.run();
}

it("selects one region and evidence date with stable evidence mapping order", async () => {
	await insertChatMessage({
		entityId: "b-at-start",
		usernameRaw: "en/Beta",
		username: null,
		text: "nullable display name",
	});
	await insertChatMessage({
		entityId: "a-at-start",
		usernameRaw: "en/Alpha",
		username: "Alpha",
		text: "start boundary",
	});
	await insertChatMessage({ entityId: "before-window", timestampTs: WINDOW_START_TS - 1 });
	await insertChatMessage({ entityId: "at-end", timestampTs: WINDOW_END_TS });
	await insertChatMessage({ entityId: "other-region", regionId: 43 });

	const messages = await d1ChatEvidenceInput(env.DB).loadEvidence({
		activeRegionId: ACTIVE_REGION_ID,
		evidenceDate: EVIDENCE_DATE,
	});

	expect(messages).toEqual([
		{
			id: "a-at-start",
			ts: WINDOW_START_TS,
			author_id: "en/Alpha",
			author_name: "Alpha",
			text: "start boundary",
		},
		{
			id: "b-at-start",
			ts: WINDOW_START_TS,
			author_id: "en/Beta",
			author_name: null,
			text: "nullable display name",
		},
	]);
});

it("returns no evidence when the region window has no rows", async () => {
	const messages = await d1ChatEvidenceInput(env.DB).loadEvidence({
		activeRegionId: "99",
		evidenceDate: EVIDENCE_DATE,
	});

	expect(messages).toEqual([]);
});

it("rejects a leading-zero region identity alias", async () => {
	await expect(
		d1ChatEvidenceInput(env.DB).loadEvidence({
			activeRegionId: "07",
			evidenceDate: EVIDENCE_DATE,
		}),
	).rejects.toMatchObject({
		name: "D1ChatEvidenceError",
		code: "d1_chat_evidence_region_id_invalid",
		activeRegionId: "07",
		evidenceDate: EVIDENCE_DATE,
	});
});

it("rejects a stored row whose author id fails the evidence message contract", async () => {
	await insertChatMessage({ entityId: "corrupt-1", usernameRaw: "" });
	const adapter = d1ChatEvidenceInput(env.DB);

	try {
		await adapter.loadEvidence({ activeRegionId: ACTIVE_REGION_ID, evidenceDate: EVIDENCE_DATE });
		expect.unreachable("loadEvidence should have thrown");
	} catch (error) {
		if (!(error instanceof D1ChatEvidenceError)) throw error;
		expect(error.code).toBe("d1_chat_evidence_row_invalid");
		expect(error.entityId).toBe("corrupt-1");
		expect(error.cause).toBeDefined();
	}
});

it("rejects a requested-region row with a non-integer timestamp", async () => {
	await insertChatMessage({
		entityId: "corrupt-timestamp",
		regionId: 77,
		timestampTs: "not-a-timestamp",
	});
	const adapter = d1ChatEvidenceInput(env.DB);

	try {
		await adapter.loadEvidence({ activeRegionId: "77", evidenceDate: EVIDENCE_DATE });
		expect.unreachable("loadEvidence should have thrown");
	} catch (error) {
		if (!(error instanceof D1ChatEvidenceError)) throw error;
		expect(error.code).toBe("d1_chat_evidence_row_invalid");
		expect(error.entityId).toBe("corrupt-timestamp");
	}
});

it("rejects a requested-region row with an out-of-contract integer timestamp", async () => {
	await env.DB.prepare(
		`INSERT INTO chat_messages (
			entity_id, region_id, channel_id, username_raw, username, text, timestamp_utc, timestamp_ts
		) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	)
		.bind(
			"out-of-contract-timestamp",
			88,
			1,
			"en/Someone",
			"Someone",
			"a message",
			"out-of-contract",
			8_640_000_000_000_001,
		)
		.run();
	const storedTimestamp = await env.DB.prepare(
		"SELECT typeof(timestamp_ts) AS storage_type FROM chat_messages WHERE entity_id = ?1",
	)
		.bind("out-of-contract-timestamp")
		.first<{ storage_type: string }>();
	expect(storedTimestamp?.storage_type).toBe("integer");

	try {
		await d1ChatEvidenceInput(env.DB).loadEvidence({
			activeRegionId: "88",
			evidenceDate: EVIDENCE_DATE,
		});
		expect.unreachable("loadEvidence should have thrown");
	} catch (error) {
		if (!(error instanceof D1ChatEvidenceError)) throw error;
		expect(error.code).toBe("d1_chat_evidence_row_invalid");
		expect(error.entityId).toBe("out-of-contract-timestamp");
	}
});

it("classifies D1 evidence contract failures as non-retryable", async () => {
	const failure = new D1ChatEvidenceError(
		"d1_chat_evidence_row_invalid",
		"stored evidence is corrupt",
		{ activeRegionId: ACTIVE_REGION_ID, evidenceDate: EVIDENCE_DATE, entityId: "corrupt-1" },
	);

	await expect(
		failNonRetryablyOnDeterministicErrors(() => {
			throw failure;
		}),
	).rejects.toBeInstanceOf(NonRetryableError);
});
