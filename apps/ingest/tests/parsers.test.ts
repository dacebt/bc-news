import { expect, it } from "vitest";
import { parseBitJitaTimestamp, parseDecimalInteger, parseUsername } from "../src/parsers";

it("parses the observed space-separated BitJita timestamp format", () => {
	expect(parseBitJitaTimestamp("2026-01-10 19:44:53+00")).toBe(Date.parse("2026-01-10T19:44:53Z"));
});

it("parses a basic-form ISO-8601 timestamp", () => {
	expect(parseBitJitaTimestamp("2026-01-10T19:44:53Z")).toBe(Date.parse("2026-01-10T19:44:53Z"));
});

// new Date rolls these forward instead of rejecting them, which would file a
// message under a day it was not sent on and hand the poller a watermark for
// an instant that never happened.
it.each([
	"2024-02-30T12:00:00Z",
	"2023-02-29T12:00:00Z",
	"2024-06-31T00:00:00Z",
	"2024-02-30 12:00:00+00",
])("rejects the rolled calendar date %s", (input) => {
	expect(parseBitJitaTimestamp(input)).toBeNull();
});

it("accepts february 29th in a leap year", () => {
	expect(parseBitJitaTimestamp("2024-02-29T12:00:00Z")).toBe(Date.parse("2024-02-29T12:00:00Z"));
});

it("rejects a timestamp before the unix epoch", () => {
	expect(parseBitJitaTimestamp("1969-12-31T23:59:59Z")).toBeNull();
});

it("rejects a non-date string", () => {
	expect(parseBitJitaTimestamp("not-a-date")).toBeNull();
});

it.each([
	["7junk", "a numeric prefix followed by garbage"],
	["12.5", "a decimal"],
	["0x10", "hex notation"],
	["1e9", "exponent notation"],
	[" 12 ", "surrounding whitespace"],
	["", "an empty string"],
])("rejects %s (%s) as a decimal integer", (input) => {
	expect(parseDecimalInteger(input)).toBeNull();
});

it.each([
	["10", 10],
	["0", 0],
	["-5", -5],
	["0042", 42],
])("parses %s as the decimal integer %d", (input, expected) => {
	expect(parseDecimalInteger(input)).toBe(expected);
});

it("splits a username on its language prefix", () => {
	expect(parseUsername("en/PlayerName")).toEqual({ lang: "en", username: "PlayerName" });
});

it("treats a username with no language prefix as unlabeled", () => {
	expect(parseUsername("PlayerName")).toEqual({ lang: null, username: "PlayerName" });
});
