import { useCallback, useEffect, useState } from "react";
import type { EditionDateRange } from "../dates/edition-date-range";
import { editionSelectionSearch, readEditionSelection, type EditionSelection } from "./edition-selection";

export function useEditionSelection(range: EditionDateRange): {
	selection: EditionSelection;
	setSelection: (next: EditionSelection) => void;
} {
	const [selection, setSelectionState] = useState(() =>
		readEditionSelection(window.location.search, range),
	);

	// The servable range shifting under an open tab -- the UTC-midnight
	// rollover, or a backward clock move that shrinks `range.maxDate` -- can
	// strand the selected date outside the new range. Re-deriving during
	// render (the render-phase adjustment idiom DateField also uses) keeps
	// React state authoritative; the effect below then writes the address bar
	// from the same resolved pair, so the URL follows state instead of being
	// rewritten independently.
	const [syncedRange, setSyncedRange] = useState(range);
	if (range !== syncedRange) {
		setSyncedRange(range);
		setSelectionState(readEditionSelection(window.location.search, range));
	}

	// Normalizes the address bar to the resolved pair (defaults and
	// out-of-range fallbacks applied) rather than leaving whatever the reader
	// typed or an old bookmark carried. Also honors browser back/forward by
	// re-reading the URL on every popstate.
	useEffect(() => {
		window.history.replaceState(
			null,
			"",
			editionSelectionSearch(readEditionSelection(window.location.search, range)),
		);

		const onPopState = () => {
			const normalized = readEditionSelection(window.location.search, range);
			window.history.replaceState(null, "", editionSelectionSearch(normalized));
			setSelectionState(normalized);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [range]);

	const setSelection = useCallback(
		(next: EditionSelection) => {
			// Controls commit on every complete, servable value they produce, not
			// just on a genuine change (see ControlsBar's DateField). Without this
			// comparison, retyping the already-committed pair pushes an identical
			// history entry -- the reader's next Back press restores the same URL
			// and the same render, so Back appears dead.
			if (
				next.activeRegionId === selection.activeRegionId
				&& next.publicationDate === selection.publicationDate
			) {
				return;
			}
			window.history.pushState(null, "", editionSelectionSearch(next));
			setSelectionState(next);
		},
		[selection],
	);

	return { selection, setSelection };
}
