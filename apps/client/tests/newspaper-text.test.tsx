import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EditionGameReference } from "../src/api/edition";
import { NewspaperText } from "../src/components/NewspaperText";

const BARE_COORDINATE_REFERENCE: EditionGameReference = {
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
					`Scout the ${BARE_COORDINATE_REFERENCE.token}.`,
					`Meet again at ${LABELED_COORDINATE_REFERENCE.token}.`,
				].join("\n\n")}
				gameReferences={[BARE_COORDINATE_REFERENCE, LABELED_COORDINATE_REFERENCE]}
			/>,
		);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(2);
		expect(links[0]?.textContent).toBe("N 3745, E 3857");
		expect(links[0]?.getAttribute("href")).toBe("https://bitcraftmap.com/?center=3745,3857&zoom=3.0");
		expect(links[0]?.getAttribute("target")).toBe("_blank");
		expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
		expect(links[1]?.textContent).toBe("Blacksmith Square");
		expect(links[1]?.getAttribute("href")).toBe("https://bitcraftmap.com/?center=3745,3857&zoom=3.0");
	});

	it("keeps markdown urls, forged tokens, and markdown-wrapped tokens inert", () => {
		const { container } = render(
			<NewspaperText
				text={[
					"[outside](https://example.com/?coord=1,2)",
					"",
					"[focused map](https://bitcraftmap.com/?center=3745,3857&zoom=3.0)",
					"",
					"[[GAME_REF_999]]",
					"",
					`[${BARE_COORDINATE_REFERENCE.token}](https://example.com/steal)`,
					"",
					"[Blacksmith Square](https://bitcraftmap.com/?center=999,999&zoom=3.0)",
					"",
					`Trusted ${LABELED_COORDINATE_REFERENCE.token}`,
				].join("\n")}
				gameReferences={[BARE_COORDINATE_REFERENCE, LABELED_COORDINATE_REFERENCE]}
			/>,
		);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(1);
		expect(links[0]?.textContent).toBe("Blacksmith Square");
		expect(links[0]?.getAttribute("href")).toBe("https://bitcraftmap.com/?center=3745,3857&zoom=3.0");
		expect(container.textContent).toContain("outside");
		expect(container.textContent).toContain("focused map");
		expect(container.textContent).toContain("[[GAME_REF_999]]");
		expect(container.textContent).toContain(BARE_COORDINATE_REFERENCE.token);
		expect(container.querySelector('a[href="https://example.com/?coord=1,2"]')).toBeNull();
		expect(container.querySelector('a[href="https://example.com/steal"]')).toBeNull();
		expect(container.querySelector('a[href="https://bitcraftmap.com/?center=999,999&zoom=3.0"]')).toBeNull();
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
