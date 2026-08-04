import { expect, it } from "vitest";
import type { BitJitaMessage } from "../src/bitjita-client";
import { mapMessageToRow } from "../src/mapping";

const VALID_MESSAGE: BitJitaMessage = {
	entityId: "msg_001",
	username: "en/PlayerOne",
	titleId: "1",
	channelId: "2",
	targetId: "region_1",
	text: "Hello world",
	timestamp: "2026-01-10 19:44:53+00",
	regionId: "10",
};

it("maps a valid message to a chat_messages row", () => {
	const result = mapMessageToRow(VALID_MESSAGE);

	expect(result).toEqual({
		entity_id: "msg_001",
		region_id: 10,
		channel_id: 2,
		target_id: "region_1",
		title_id: 1,
		username_raw: "en/PlayerOne",
		lang: "en",
		username: "PlayerOne",
		text: "Hello world",
		timestamp_utc: "2026-01-10 19:44:53+00",
		timestamp_ts: Date.parse("2026-01-10T19:44:53Z"),
	});
});

it("falls back to messageId for identity when entityId is absent", () => {
	const result = mapMessageToRow({
		username: "en/PlayerOne",
		titleId: "1",
		channelId: "2",
		targetId: "region_1",
		text: "Hello world",
		timestamp: "2026-01-10 19:44:53+00",
		regionId: "10",
		messageId: "msg_fallback",
	});

	expect(result?.entity_id).toBe("msg_fallback");
});

it.each<[string, Partial<BitJitaMessage>]>([
	["identity (entityId and messageId)", { entityId: undefined }],
	["username", { username: undefined }],
	["regionId", { regionId: undefined }],
	["channelId", { channelId: undefined }],
	["text", { text: undefined }],
	["timestamp", { timestamp: undefined }],
])("rejects a message missing %s", (_label, override) => {
	expect(mapMessageToRow({ ...VALID_MESSAGE, ...override })).toBeNull();
});

// Identifiers a parseInt-based mapping would accept by reading a numeric
// prefix and discarding the rest: "10junk" would become region 10, filing a
// message under an identifier nobody sent.
it.each<[string, Partial<BitJitaMessage>]>([
	["a regionId with trailing garbage", { regionId: "10junk" }],
	["a regionId in exponent notation", { regionId: "1e9" }],
	["a channelId with trailing whitespace", { channelId: "2 " }],
	["a channelId in hex notation", { channelId: "0x10" }],
])("rejects %s rather than coercing it", (_label, override) => {
	expect(mapMessageToRow({ ...VALID_MESSAGE, ...override })).toBeNull();
});

it("rejects a titleId that is present but unparsable", () => {
	expect(mapMessageToRow({ ...VALID_MESSAGE, titleId: "1.5" })).toBeNull();
});

it("stores an absent titleId as null, distinct from a rejected one", () => {
	const result = mapMessageToRow({
		entityId: "msg_003",
		username: "en/PlayerThree",
		channelId: "2",
		text: "Hello",
		timestamp: "2026-01-10 19:44:53+00",
		regionId: "10",
	});

	expect(result?.title_id).toBeNull();
});

it("rejects a message whose timestamp rolls a calendar date forward", () => {
	expect(mapMessageToRow({ ...VALID_MESSAGE, timestamp: "2024-02-30T12:00:00Z" })).toBeNull();
});

it("retains username_raw alongside the lang/username split", () => {
	const result = mapMessageToRow({ ...VALID_MESSAGE, username: "fr/PlayerThree" });

	expect(result?.username_raw).toBe("fr/PlayerThree");
	expect(result?.lang).toBe("fr");
	expect(result?.username).toBe("PlayerThree");
});

it("treats a username with no language prefix as unlabeled with no lang", () => {
	const result = mapMessageToRow({ ...VALID_MESSAGE, username: "PlayerFour" });

	expect(result?.lang).toBeNull();
	expect(result?.username).toBe("PlayerFour");
});
