import type { ComponentStyleConfig } from "@chakra-ui/react";

export const button: ComponentStyleConfig = {
	baseStyle: {
		borderRadius: "sm",
		fontWeight: "medium",
		transition: "all 0.2s",
	},
	variants: {
		// Primary button - white on black
		primary: {
			bg: "bw.900",
			color: "bw.0",
			border: "1px solid",
			borderColor: "bw.900",
			_hover: {
				bg: "bw.800",
				borderColor: "bw.800",
				transform: "translateY(-1px)",
				boxShadow: "md",
			},
			_active: {
				transform: "translateY(0)",
			},
		},
		// Secondary - outlined white
		secondary: {
			bg: "transparent",
			color: "text.primary",
			border: "1px solid",
			borderColor: "border.default",
			_hover: {
				borderColor: "border.hover",
				bg: "surface.overlay",
			},
		},
		// Ghost - minimal
		ghost: {
			bg: "transparent",
			color: "text.secondary",
			_hover: {
				bg: "surface.overlay",
				color: "text.primary",
			},
		},
		// Primary action - teal/cyan (matches badge.primary)
		primaryAction: {
			bg: "status.infoBg",
			color: "status.info",
			border: "1px solid",
			borderColor: "status.infoBorder",
			_hover: {
				bg: "rgba(76, 201, 240, 0.25)",
				borderColor: "status.info",
			},
		},
		// Secondary action - purple (matches badge.secondary)
		secondaryAction: {
			bg: "rgba(168, 85, 247, 0.15)",
			color: "#a855f7",
			border: "1px solid",
			borderColor: "rgba(168, 85, 247, 0.4)",
			_hover: {
				bg: "rgba(168, 85, 247, 0.25)",
				borderColor: "#a855f7",
			},
		},
		// Destructive/warning action - pink (matches badge.warning)
		danger: {
			bg: "status.warningBg",
			color: "status.warning",
			border: "1px solid",
			borderColor: "status.warningBorder",
			_hover: {
				bg: "rgba(236, 72, 153, 0.2)",
				borderColor: "status.warning",
			},
		},
	},
	defaultProps: {
		variant: "secondary",
	},
};
