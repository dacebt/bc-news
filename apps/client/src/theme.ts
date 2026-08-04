import { extendTheme, type ThemeConfig } from "@chakra-ui/react";

const config: ThemeConfig = {
	initialColorMode: "dark",
	useSystemColorMode: false,
};

export const theme = extendTheme({
	config,
	colors: {
		surface: {
			base: "#000000",
		},
		paper: {
			bg: "#f0ede5", // Off-white, warm gray paper
			ink: "#1a1a1a", // Near-black ink
			muted: "#666666", // Muted text for metadata
			rule: "#d4d4d4", // Hairline rules/borders
			accent: "#4a4a4a", // Subtle accent
		},
	},
	fonts: {
		heading: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`,
		body: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`,
	},
	shadows: {
		paper: "0 2px 8px rgba(0, 0, 0, 0.12)",
	},
	styles: {
		global: {
			body: {
				bg: "surface.base",
			},
		},
	},
});
