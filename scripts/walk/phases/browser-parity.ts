import { EditionSchema, type Edition, type GenerationRunParams } from "@bc-news/contracts";
import { chromium, type Page } from "playwright-core";
import {
	ALLOWED_NOT_FOUND_PAIRS,
	consoleErrorViolation,
	pairKey,
	requestFailureViolation,
	requestOriginViolation,
	responseViolation,
} from "../browser-policy";
import {
	assertPublishedGameReferences,
	EXPECTED_GAME_REFERENCES,
	EXPECTED_REFERENCE_OCCURRENCES_PER_DISPLAY,
	EXPECTED_TRUSTED_FOCUSED_MAP_LINK_COUNT,
	FOCUSED_MAP_DESTINATION,
	renderedMarkdownText,
	SPOOFED_FOCUSED_MAP_DESTINATION,
} from "../game-reference-assertions";
import type { WalkContext, WalkPhase } from "../phase";

const ABSENT_COPY = "No published edition for this region/date.";

function assertEqual(actual: unknown, expected: unknown, label: string): void {
	if (actual !== expected) {
		throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function expectedDateline(edition: Edition): string {
	const date = new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${edition.publication_date}T00:00:00Z`));
	return `${date.toUpperCase()} · REGION ${edition.active_region_id}`;
}

function assertQuery(page: Page, pair: GenerationRunParams): void {
	const url = new URL(page.url());
	assertEqual(url.searchParams.get("active_region_id"), pair.active_region_id, "active_region_id query");
	assertEqual(url.searchParams.get("publication_date"), pair.publication_date, "publication_date query");
	assertEqual(url.searchParams.size, 2, "normalized query parameter count");
}

function editionResponseMatches(responseUrl: string, pair: GenerationRunParams): boolean {
	const url = new URL(responseUrl);
	return url.pathname === "/api/edition"
		&& url.searchParams.get("active_region_id") === pair.active_region_id
		&& url.searchParams.get("publication_date") === pair.publication_date;
}

function readerUrl(baseUrl: string, pair: GenerationRunParams): string {
	const url = new URL("/", baseUrl);
	url.search = new URLSearchParams(pair).toString();
	return url.toString();
}

async function waitForPairResponse(
	page: Page,
	pair: GenerationRunParams,
	action: () => Promise<void>,
): Promise<void> {
	const responsePromise = page.waitForResponse((response) => editionResponseMatches(response.url(), pair));
	await action();
	await responsePromise;
}

async function assertFocusedMapLinks(
	page: Page,
	text: string,
	label: string,
	expectedCount: number,
): Promise<void> {
	const links = page.getByRole("link", { name: text, exact: true });
	await links.first().waitFor();
	assertEqual(await links.count(), expectedCount, `${label} count`);
	for (let index = 0; index < expectedCount; index += 1) {
		const link = links.nth(index);
		assertEqual(await link.getAttribute("href"), FOCUSED_MAP_DESTINATION, `${label} href ${String(index + 1)}`);
		assertEqual(await link.getAttribute("target"), "_blank", `${label} target ${String(index + 1)}`);
		assertEqual(await link.getAttribute("rel"), "noopener noreferrer", `${label} rel ${String(index + 1)}`);
	}
}

async function assertPublishedEdition(page: Page, edition: Edition, rawEdition: unknown): Promise<void> {
	await page.getByRole("heading", { level: 1, name: edition.title, exact: true }).waitFor();
	assertEqual(
		await page.title(),
		`Region ${edition.active_region_id} - ${edition.main_story.headline} - BitCraft News`,
		"document title",
	);
	await page.getByRole("heading", { level: 2, name: edition.main_story.headline, exact: true }).waitFor();
	await page.getByText(expectedDateline(edition), { exact: true }).waitFor();
	assertEqual(await page.getByText("Region:", { exact: true }).innerText(), "Region:", "region control label");
	assertEqual(await page.getByText("Date:", { exact: true }).innerText(), "Date:", "date control label");
	assertEqual(await page.locator("select").inputValue(), edition.active_region_id, "region control value");
	const dateInput = page.locator('input[type="date"]');
	assertEqual(await dateInput.inputValue(), edition.publication_date, "date control value");
	assertEqual(await dateInput.getAttribute("min"), edition.publication_date, "date control minimum");
	const titles = await page.locator("h4").allInnerTexts();
	assertEqual(JSON.stringify(titles), JSON.stringify(edition.announcements.map((item) => item.title)), "announcement titles");
	for (let index = 0; index < edition.announcements.length; index++) {
		const summary = await page.locator("h4").nth(index).locator("xpath=following-sibling::div").innerText();
		assertEqual(
			summary,
			renderedMarkdownText(edition.announcements[index]!.summary, rawEdition),
			`announcement ${String(index)} summary`,
		);
	}
	await assertFocusedMapLinks(
		page,
		EXPECTED_GAME_REFERENCES[0]!.display_text,
		"named focused map link",
		EXPECTED_REFERENCE_OCCURRENCES_PER_DISPLAY,
	);
	await assertFocusedMapLinks(
		page,
		EXPECTED_GAME_REFERENCES[1]!.display_text,
		"bare focused map link",
		EXPECTED_REFERENCE_OCCURRENCES_PER_DISPLAY,
	);
	assertEqual(
		await page.locator(`a[href="${FOCUSED_MAP_DESTINATION}"]`).count(),
		EXPECTED_TRUSTED_FOCUSED_MAP_LINK_COUNT,
		"focused map link count",
	);
	assertEqual(await page.locator(`a[href="${SPOOFED_FOCUSED_MAP_DESTINATION}"]`).count(), 0, "spoofed markdown link count");
}

async function run(ctx: WalkContext): Promise<void> {
	if (ctx.state.firstServedEditionBody === undefined) {
		throw new Error("browser parity requires the strict served edition captured by publish-poll");
	}
	const rawEdition = JSON.parse(ctx.state.firstServedEditionBody) as unknown;
	const edition = EditionSchema.parse(rawEdition);
	assertPublishedGameReferences(rawEdition);
	const expectedOrigin = new URL(ctx.baseUrl).origin;
	const failures: string[] = [];
	const allowedNotFoundPairs: string[] = [];
	const observedAllowedNotFoundUrls = new Set<string>();

	const browser = await chromium.launch({ channel: "chrome", headless: true });
	ctx.registerBrowser(browser);
	const context = await browser.newContext({ serviceWorkers: "block" });
	await context.route("**/*", async (route) => {
		const violation = requestOriginViolation(route.request().url(), expectedOrigin);
		if (violation !== null) {
			failures.push(violation);
			await route.abort("blockedbyclient");
			return;
		}
		await route.continue();
	});
	const page = await context.newPage();
	await page.clock.setFixedTime(new Date("2026-08-26T12:00:00.000Z"));
	page.on("response", (response) => {
		const classification = responseViolation(response.url(), response.status(), expectedOrigin);
		if (classification.violation !== null) failures.push(classification.violation);
		if (classification.allowedNotFoundPair !== null) allowedNotFoundPairs.push(classification.allowedNotFoundPair);
		if (classification.allowedNotFoundUrl !== null) {
			observedAllowedNotFoundUrls.add(classification.allowedNotFoundUrl);
		}
	});
	page.on("requestfailed", (request) => {
		const violation = requestFailureViolation(
			request.url(),
			request.failure()?.errorText ?? "unknown",
			observedAllowedNotFoundUrls,
		);
		if (violation !== null) failures.push(violation);
	});
	page.on("pageerror", (error) => failures.push(`browser page error: ${error.message}`));
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		const violation = consoleErrorViolation(
			message.text(),
			message.location().url,
			observedAllowedNotFoundUrls,
		);
		if (violation !== null) failures.push(violation);
	});

	await waitForPairResponse(page, ctx.pair, async () => {
		await page.goto(readerUrl(ctx.baseUrl, ctx.pair), { waitUntil: "domcontentloaded" });
	});
	await assertPublishedEdition(page, edition, rawEdition);
	assertQuery(page, ctx.pair);

	const unavailableRegion = ALLOWED_NOT_FOUND_PAIRS[0]!;
	await waitForPairResponse(page, unavailableRegion, async () => {
		await page.locator("select").selectOption(unavailableRegion.active_region_id);
	});
	await page.getByText(ABSENT_COPY, { exact: true }).waitFor();
	assertQuery(page, unavailableRegion);

	await waitForPairResponse(page, ctx.pair, async () => page.goBack().then(() => {}));
	await assertPublishedEdition(page, edition, rawEdition);
	assertQuery(page, ctx.pair);

	const unavailableDate = ALLOWED_NOT_FOUND_PAIRS[1]!;
	await waitForPairResponse(page, unavailableDate, async () => {
		await page.getByRole("button", { name: "Next day", exact: true }).click();
	});
	await page.getByText(ABSENT_COPY, { exact: true }).waitFor();
	assertQuery(page, unavailableDate);

	await waitForPairResponse(page, ctx.pair, async () => page.goBack().then(() => {}));
	await assertPublishedEdition(page, edition, rawEdition);
	assertQuery(page, ctx.pair);

	const expectedNotFound = ALLOWED_NOT_FOUND_PAIRS.map(pairKey).sort();
	assertEqual(JSON.stringify([...allowedNotFoundPairs].sort()), JSON.stringify(expectedNotFound), "allowed browser 404s");
	if (failures.length > 0) throw new Error(failures.join("\n"));
	console.log("walk: real-browser parity passed with exact same-origin traffic and two expected 404s");
}

export const walkPhase: WalkPhase = { name: "browser-parity", run };
