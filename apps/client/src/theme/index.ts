import { extendTheme, type ThemeConfig } from "@chakra-ui/react";

import { components } from "./components";
import { palette } from "./palette";
import { spacing } from "./spacing";
import { typography } from "./typography";

const config: ThemeConfig = {
	initialColorMode: "dark",
	useSystemColorMode: false,
};

export const theme = extendTheme({
	config,
	colors: {
		...palette,
		// Newspaper content tokens (scoped to paper wrapper)
		paper: {
			bg: "#f0ede5",        // Off-white, warm gray paper
			ink: "#1a1a1a",       // Near-black ink
			muted: "#666666",     // Muted text for metadata
			rule: "#d4d4d4",      // Hairline rules/borders
			accent: "#4a4a4a",    // Subtle accent (optional)
			link: "#1f5f99",      // Muted blue, distinct from newspaper ink
			linkHover: "#17476f", // Darker blue for hover and keyboard focus
		},
	},
	components,
	...typography,
	space: spacing,
	radii: {
		none: "0",
		sm: "0.375rem",
		md: "0.5rem",
		lg: "0.75rem",
		xl: "1rem",
		"2xl": "1.5rem",
		"3xl": "2rem",
		full: "9999px",
	},
	shadows: {
		paper: "0 2px 8px rgba(0, 0, 0, 0.12)", // Subtle paper shadow
	},
	zIndices: {
		base: 0,
		tooltip: 1500,
		menuIcon: 999,
		menu: 1000,
		overlay: 10000,
	},
	styles: {
		global: {
			body: {
				bg: "surface.base",
				color: "text.primary",
			},
			// Custom dark scrollbar styling for webkit browsers
			"::-webkit-scrollbar": {
				width: "8px",
				height: "8px",
			},
			"::-webkit-scrollbar-track": {
				backgroundColor: "#1a1a1a", // surface.overlay
			},
			"::-webkit-scrollbar-thumb": {
				backgroundColor: "rgba(255, 255, 255, 0.15)", // border.default
				borderRadius: "4px",
			},
			"::-webkit-scrollbar-thumb:hover": {
				backgroundColor: "rgba(255, 255, 255, 0.25)", // border.hover
			},
			// Firefox scrollbar styling
			"*": {
				scrollbarWidth: "thin",
				scrollbarColor: "rgba(255, 255, 255, 0.15) #1a1a1a",
			},
		},
	},
});
