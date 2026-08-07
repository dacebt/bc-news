import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewspaperText } from "../src/components/NewspaperText";

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

	it("keeps raw active content inert", () => {
		const { container } = render(
			<NewspaperText text={'Before <script>alert("owned")</script> after'} />,
		);

		expect(container.querySelector("script")).toBeNull();
		expect(container.textContent).toBe('Before alert("owned") after');
		expect(container.innerHTML).not.toContain("<script");
	});
});
