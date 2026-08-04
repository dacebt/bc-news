// Black & White Theme Palette
// Core color definitions for the Bitcraft theme

export const palette = {
	// Pure black & white base
	bw: {
		0: "#000000", // Pure black
		50: "#0a0a0a", // Near black
		100: "#1a1a1a", // Very dark gray
		200: "#2a2a2a", // Dark gray
		300: "#3a3a3a", // Medium dark gray
		400: "#4a4a4a", // Medium gray
		500: "#5a5a5a", // Mid gray
		600: "#6a6a6a", // Light gray
		700: "#7a7a7a", // Lighter gray
		800: "#8a8a8a", // Even lighter gray
		900: "#ffffff", // Pure white
	},

	// Text colors - white at varying opacities
	text: {
		primary: "#ffffff",
		secondary: "rgba(255, 255, 255, 0.8)",
		tertiary: "rgba(255, 255, 255, 0.6)",
		muted: "rgba(255, 255, 255, 0.4)",
	},

	// Surface/background colors - near-black variants
	surface: {
		base: "#000000", // Pure black background
		elevated: "#0a0a0a", // Slightly lighter for cards/elevated surfaces
		overlay: "#1a1a1a", // Even lighter for modals/overlays
		hover: "rgba(255, 255, 255, 0.05)", // Hover state background
		hoverSubtle: "rgba(255, 255, 255, 0.03)", // Subtle hover state background
	},

	// Border colors - white at varying opacities
	border: {
		default: "rgba(255, 255, 255, 0.15)",
		hover: "rgba(255, 255, 255, 0.25)",
		focus: "rgba(255, 255, 255, 0.4)",
	},

	// Action accent (sparingly used for primary actions)
	accent: {
		action: "#ffffff", // White for primary actions
	},

	// Status colors backing the Button primaryAction/danger variants
	status: {
		info: "#4cc9f0", // Cyan for informational states
		infoBg: "rgba(76, 201, 240, 0.15)", // Info background
		infoBorder: "rgba(76, 201, 240, 0.4)", // Info border
		warning: "#ec4899", // Warning/required state (pink)
		warningBg: "rgba(236, 72, 153, 0.1)", // Warning background
		warningBorder: "rgba(236, 72, 153, 0.5)", // Warning border
	},
} as const;
