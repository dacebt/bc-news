import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EditionGameReference } from "../src/api/edition";
import { NewspaperText } from "../src/components/NewspaperText";

const COORDINATE_REFERENCE: EditionGameReference = {
	token: "[[GAME_REF_001]]",
	kind: "coord",
	northing: 3745,
	easting: 3857,
	display_text: "N 3745, E 3857",
	destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
};

const LABELED_COORDINATE_REFERENCE: EditionGameReference = {
	token: "[[GAME_REF_002]]",
	kind: "coord",
	northing: 3745,
	easting: 3857,
	display_text: "Blacksmith Square",
	destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
};

const ENTITY_REFERENCES: readonly EditionGameReference[] = [
	{
		token: "[[GAME_REF_003]]",
		kind: "item",
		id: "163977632",
		display_text: "Ornate Leather Shirt",
		destination_url: "https://bitjita.com/items/163977632",
	},
	{
		token: "[[GAME_REF_004]]",
		kind: "cargo",
		id: "833769059",
		display_text: "Settlement Foundation Kit",
		destination_url: "https://bitjita.com/cargo/833769059",
	},
	{
		token: "[[GAME_REF_005]]",
		kind: "claim",
		id: "864691128594607212",
		display_text: "Serpents Hold",
		destination_url: "https://bitjita.com/claims/864691128594607212",
	},
	{
		token: "[[GAME_REF_006]]",
		kind: "coll",
		id: "381044074",
		display_text: "Wagon (III)",
		destination_url: "https://bitjita.com/collectibles/381044074",
	},
	{
		token: "[[GAME_REF_007]]",
		kind: "res",
		id: "1045808810",
		display_text: "Pyrelite Outcrop Interior",
		destination_url: "https://bitjita.com/resources/1045808810",
	},
] as const;

const MALICIOUS_DISPLAY_REFERENCE: EditionGameReference = {
	token: "[[GAME_REF_008]]",
	kind: "item",
	id: "42",
	display_text: "[spoofed map](https://example.com) **bold** <script>alert(1)</script>",
	destination_url: "https://bitjita.com/items/42",
};

function expectLink(name: string, href: string): void {
	const link = screen.getByRole("link", { name });
	expect(link.getAttribute("href")).toBe(href);
	expect(link.getAttribute("target")).toBe("_blank");
	expect(link.getAttribute("rel")).toBe("noopener noreferrer");
}

describe("NewspaperText", () => {
	it("renders the newspaper prose vocabulary", () => {
		const { container } = render(
			<NewspaperText text={"First paragraph.\n\nSecond has **weight** and *emphasis*."} />,
		);

		expect(container.querySelectorAll("p")).toHaveLength(2);
		expect(container.querySelector("strong")?.textContent).toBe("weight");
		expect(container.querySelector("em")?.textContent).toBe("emphasis");
	});

	it("uses blank lines rather than every source line as paragraph boundaries", () => {
		const { container } = render(<NewspaperText text={"First line\nsecond line"} />);

		expect(container.querySelectorAll("p")).toHaveLength(1);
		expect(container.querySelector("p")?.textContent).toBe("First line\nsecond line");
	});

	it("removes unsupported markdown structures and destinations", () => {
		const { container } = render(
			<NewspaperText
				text={[
					"# Heading",
					"",
					"- [linked words](https://example.com)",
					"- ![tracking pixel](https://example.com/pixel.gif)",
					"",
					"> quoted words",
				].join("\n")}
			/>,
		);

		expect(container.querySelector("h1, ul, li, a, img, blockquote")).toBeNull();
		expect(container.textContent).toContain("Heading");
		expect(container.textContent).toContain("linked words");
		expect(container.textContent).toContain("quoted words");
		expect(container.textContent).not.toContain("https://example.com");
	});

	it("renders retained coordinate tokens as truthful focused-map links", () => {
		render(
			<NewspaperText
				text={[
					`Scout the ${COORDINATE_REFERENCE.token}.`,
					`Meet again at ${LABELED_COORDINATE_REFERENCE.token}.`,
				].join("\n\n")}
				gameReferences={[COORDINATE_REFERENCE, LABELED_COORDINATE_REFERENCE]}
			/>,
		);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(2);
		expect(links[0]?.textContent).toBe(COORDINATE_REFERENCE.display_text);
		expect(links[0]?.getAttribute("href")).toBe(COORDINATE_REFERENCE.destination_url);
		expect(links[1]?.textContent).toBe(LABELED_COORDINATE_REFERENCE.display_text);
		expect(links[1]?.getAttribute("href")).toBe(LABELED_COORDINATE_REFERENCE.destination_url);
	});

	it("renders exact canonical BitJita links for all supported entity kinds", () => {
		render(
			<NewspaperText
				text={ENTITY_REFERENCES.map((reference) => reference.token).join("\n\n")}
				gameReferences={ENTITY_REFERENCES}
			/>,
		);

		expectLink("Ornate Leather Shirt", "https://bitjita.com/items/163977632");
		expectLink("Settlement Foundation Kit", "https://bitjita.com/cargo/833769059");
		expectLink("Serpents Hold", "https://bitjita.com/claims/864691128594607212");
		expectLink("Wagon (III)", "https://bitjita.com/collectibles/381044074");
		expectLink("Pyrelite Outcrop Interior", "https://bitjita.com/resources/1045808810");
	});

	it("renders display_text as literal anchor text instead of markdown", () => {
		const { container } = render(
			<NewspaperText
				text={`Trusted ${MALICIOUS_DISPLAY_REFERENCE.token}`}
				gameReferences={[MALICIOUS_DISPLAY_REFERENCE]}
			/>,
		);

		const link = screen.getByRole("link", { name: MALICIOUS_DISPLAY_REFERENCE.display_text });
		expect(link.getAttribute("href")).toBe("https://bitjita.com/items/42");
		expect(link.innerHTML).not.toContain("<strong");
		expect(link.innerHTML).not.toContain("<script");
		expect(container.querySelector('a[href="https://example.com"]')).toBeNull();
	});

	it("keeps markdown urls, forged tokens, and markdown-wrapped tokens inert", () => {
		const { container } = render(
			<NewspaperText
				text={[
					"[outside](https://example.com/?coord=1,2)",
					"",
					"[item page](https://bitjita.com/items/163977632)",
					"",
					"[[GAME_REF_999]]",
					"",
					`[${ENTITY_REFERENCES[0]!.token}](https://example.com/steal)`,
					"",
					"[Ornate Leather Shirt](https://bitjita.com/items/999999999)",
					"",
					`Trusted ${ENTITY_REFERENCES[0]!.token}`,
					"",
					`Map ${LABELED_COORDINATE_REFERENCE.token}`,
				].join("\n")}
				gameReferences={[ENTITY_REFERENCES[0]!, LABELED_COORDINATE_REFERENCE]}
			/>,
		);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(2);
		expect(links[0]?.textContent).toBe("Ornate Leather Shirt");
		expect(links[0]?.getAttribute("href")).toBe("https://bitjita.com/items/163977632");
		expect(links[1]?.textContent).toBe("Blacksmith Square");
		expect(links[1]?.getAttribute("href")).toBe("https://bitcraftmap.com/?center=3745,3857&zoom=3.0");
		expect(container.textContent).toContain("outside");
		expect(container.textContent).toContain("item page");
		expect(container.textContent).toContain("[[GAME_REF_999]]");
		expect(container.textContent).toContain(ENTITY_REFERENCES[0]!.token);
		expect(container.querySelector('a[href="https://example.com/?coord=1,2"]')).toBeNull();
		expect(container.querySelector('a[href="https://example.com/steal"]')).toBeNull();
		expect(container.querySelector('a[href="https://bitjita.com/items/999999999"]')).toBeNull();
	});

	it("keeps raw active content inert", () => {
		const { container } = render(
			<NewspaperText text={'Before <script>alert("owned")</script> after'} />,
		);

		expect(container.querySelector("script")).toBeNull();
		expect(container.textContent).toBe('Before alert("owned") after');
		expect(container.innerHTML).not.toContain("<script");
	});
});
