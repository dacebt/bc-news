import type { ComponentStyleConfig } from "@chakra-ui/react";

export const link: ComponentStyleConfig = {
	baseStyle: {
		color: "text.secondary",
		textDecoration: "none",
		transition: "all 0.2s",
		_hover: {
			color: "text.primary",
			textDecoration: "underline",
		},
	},
	variants: {
		// Text link for normal links (default)
		text: {
			color: "text.secondary",
			_hover: {
				color: "text.primary",
				textDecoration: "underline",
			},
		},
	},
	defaultProps: {
		variant: "text",
	},
};
