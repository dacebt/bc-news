import type { ComponentStyleConfig } from "@chakra-ui/react";

export const input: ComponentStyleConfig = {
	baseStyle: {
		field: {
			bg: "surface.elevated",
			color: "text.primary",
			borderRadius: "sm",
			border: "1px solid",
			borderColor: "border.default",
			transition: "all 0.2s",
			_placeholder: {
				color: "text.muted",
			},
		},
	},
	variants: {
		outline: {
			field: {
				borderColor: "border.default",
				_hover: {
					borderColor: "border.hover",
				},
				_focus: {
					borderColor: "border.focus",
					boxShadow: "0 0 0 1px var(--chakra-colors-border-focus)",
				},
			},
		},
	},
	defaultProps: {
		variant: "outline",
	},
};
