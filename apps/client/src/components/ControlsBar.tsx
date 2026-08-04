import { useEffect, useRef, useState } from "react";
import { Button, Flex, Input, Link as ChakraLink, Select, Spinner, Text } from "@chakra-ui/react";
import { ACTIVE_REGION_IDS } from "@bc-news/contracts";
import { isServableDate, stepWithinRange, type EditionDateRange } from "../dates/edition-date-range";
import type { EditionSelection } from "../selection/edition-selection";

interface DateFieldProps {
	selection: EditionSelection;
	dateRange: EditionDateRange;
	onCommit: (date: string) => void;
}

// The input's own text, separate from the committed date: a keystroke has to
// be visible immediately (a controlled input can only show its own value
// back), but committing it - history entry and fetch - is reserved for a
// value the browser itself considers settled.
//
// Two things drift the draft from the truth if left unhandled:
//
// 1. Commit timing. React's onChange for `type="date"` normalizes to the
//    native `input` event, which fires once per keystroke - typing a second
//    day digit over an existing one already yields a complete, in-range
//    date after the first digit alone. Committing there turns every
//    keystroke into a history entry and a fetch. The native `change` event
//    fires only when the browser considers editing settled (blur, Enter, or
//    a picker selection), so it - not onChange - drives the commit, wired
//    directly via a ref since React does not expose it as a distinct prop.
// 2. Resync scope. A draft that never became servable (out of range,
//    cleared, mid-edit) has to snap back to the truth whenever the truth
//    might have moved on without it - not only when `selection.publicationDate`
//    itself changes, but on a region change, a popstate restore, or a UTC
//    rollover widening `dateRange`, none of which necessarily touch the
//    date string. `selection` and `dateRange` are stable references (state,
//    not recomputed each render) except on a genuine external update, so
//    comparing their identity - not just the date value - catches all of
//    those. Resynced during render rather than via a `key` remount or an
//    effect: a remount tears down and recreates the DOM `<input>`, dropping
//    focus to `<body>` on every commit and breaking keyboard/segment-by-
//    segment date entry.
function DateField({ selection, dateRange, onCommit }: DateFieldProps) {
	const [draftDate, setDraftDate] = useState(selection.publicationDate);
	const [syncedSelection, setSyncedSelection] = useState(selection);
	const [syncedDateRange, setSyncedDateRange] = useState(dateRange);
	const inputRef = useRef<HTMLInputElement | null>(null);

	if (selection !== syncedSelection || dateRange !== syncedDateRange) {
		setSyncedSelection(selection);
		setSyncedDateRange(dateRange);
		setDraftDate(selection.publicationDate);
	}

	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		const commitIfServable = () => {
			if (isServableDate(input.value, dateRange)) {
				onCommit(input.value);
			}
		};
		input.addEventListener("change", commitIfServable);
		return () => input.removeEventListener("change", commitIfServable);
	}, [dateRange, onCommit]);

	return (
		<Input
			ref={inputRef}
			size="sm"
			type="date"
			value={draftDate}
			// Keeps the field responsive on every keystroke; committing is the
			// native `change` listener's job (see above), not this handler's.
			onChange={(event) => setDraftDate(event.target.value)}
			min={dateRange.minDate}
			max={dateRange.maxDate}
			bg="surface.base"
			borderColor="border.default"
			color="text.primary"
			maxW="140px"
			aria-labelledby="date-label"
		/>
	);
}

interface ControlsBarProps {
	selection: EditionSelection;
	onSelectionChange: (next: EditionSelection) => void;
	dateRange: EditionDateRange;
	isBusy: boolean;
}

export function ControlsBar({ selection, onSelectionChange, dateRange, isBusy }: ControlsBarProps) {
	const previousDate = stepWithinRange(selection.publicationDate, -1, dateRange);
	const nextDate = stepWithinRange(selection.publicationDate, 1, dateRange);

	return (
		<Flex
			p={4}
			borderBottom="1px"
			borderColor="border.default"
			bg="surface.overlay"
			align="center"
			justify="space-between"
			wrap="wrap"
			gap={4}
		>
			<Flex align="center" gap={4}>
				<Text fontSize="lg" fontWeight="medium" color="text.secondary">
					BitCraft Codex News
				</Text>
				<ChakraLink
					href="https://bccodex.com"
					fontSize="sm"
					fontWeight="medium"
					color="text.tertiary"
					_hover={{ color: "text.secondary", textDecoration: "none" }}
					transition="color 0.2s"
				>
					bccodex.com
				</ChakraLink>
			</Flex>

			<Flex align="center" gap={3} wrap={{ base: "wrap", sm: "nowrap" }} minW="0">
				<Flex align="center" gap={2}>
					<Text color="text.secondary" fontSize="xs" whiteSpace="nowrap" id="region-label">
						Region:
					</Text>
					<Select
						size="sm"
						value={selection.activeRegionId}
						onChange={(event) =>
							onSelectionChange({ ...selection, activeRegionId: event.target.value })
						}
						bg="surface.base"
						borderColor="border.default"
						color="text.primary"
						maxW="120px"
						aria-labelledby="region-label"
					>
						{ACTIVE_REGION_IDS.map((id) => (
							<option key={id} value={id}>
								Region {id}
							</option>
						))}
					</Select>
				</Flex>

				<Flex align="center" gap={2}>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							if (previousDate !== null) {
								onSelectionChange({ ...selection, publicationDate: previousDate });
							}
						}}
						isDisabled={previousDate === null}
						aria-label="Previous day"
					>
						←
					</Button>
					<Flex align="center" gap={2}>
						<Text color="text.secondary" fontSize="xs" whiteSpace="nowrap" id="date-label">
							Date:
						</Text>
						<DateField
							selection={selection}
							dateRange={dateRange}
							onCommit={(next) => onSelectionChange({ ...selection, publicationDate: next })}
						/>
					</Flex>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							if (nextDate !== null) {
								onSelectionChange({ ...selection, publicationDate: nextDate });
							}
						}}
						isDisabled={nextDate === null}
						aria-label="Next day"
					>
						→
					</Button>
				</Flex>

				{isBusy && <Spinner size="sm" color="text.primary" />}
			</Flex>
		</Flex>
	);
}
