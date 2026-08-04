import { ChakraProvider } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControlsBar } from "../src/components/ControlsBar";
import type { EditionDateRange } from "../src/dates/edition-date-range";
import type { EditionSelection } from "../src/selection/edition-selection";
import { theme } from "../src/theme";

const RANGE: EditionDateRange = { minDate: "2026-01-15", maxDate: "2026-07-25" };
const SELECTION: EditionSelection = { activeRegionId: "7", publicationDate: "2026-03-10" };

function renderControlsBar(onSelectionChange: (next: EditionSelection) => void) {
	return render(
		<ChakraProvider theme={theme}>
			<ControlsBar
				selection={SELECTION}
				onSelectionChange={onSelectionChange}
				dateRange={RANGE}
				isBusy={false}
			/>
		</ChakraProvider>,
	);
}

describe("ControlsBar date input", () => {
	it("commits a complete servable date", () => {
		const onSelectionChange = vi.fn();
		renderControlsBar(onSelectionChange);

		fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2026-03-15" } });

		expect(onSelectionChange).toHaveBeenCalledWith({ ...SELECTION, publicationDate: "2026-03-15" });
	});

	it("never commits a cleared field", () => {
		const onSelectionChange = vi.fn();
		renderControlsBar(onSelectionChange);

		fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "" } });

		expect(onSelectionChange).not.toHaveBeenCalled();
	});

	it("never commits a date outside the servable range", () => {
		const onSelectionChange = vi.fn();
		renderControlsBar(onSelectionChange);

		fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2020-01-01" } });

		expect(onSelectionChange).not.toHaveBeenCalled();
	});

	it("leaves the arrows operative after the field is cleared", () => {
		const onSelectionChange = vi.fn();
		renderControlsBar(onSelectionChange);

		fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "" } });

		expect(screen.getByLabelText("Previous day").hasAttribute("disabled")).toBe(false);
		expect(screen.getByLabelText("Next day").hasAttribute("disabled")).toBe(false);
	});
});
