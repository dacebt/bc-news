import { Box, type BoxProps } from "@chakra-ui/react";
import { getTextureLayers } from "../styles/paper-texture";

interface PaperWrapperProps extends BoxProps {
	children: React.ReactNode;
}

export function PaperWrapper({ children, ...props }: PaperWrapperProps) {
	return (
		<Box
			bg="paper.bg"
			color="paper.ink"
			maxW="1200px"
			w="100%"
			p={{ base: 6, md: 10 }}
			border="1px"
			borderColor="paper.rule"
			boxShadow="paper"
			position="relative"
			{...props}
		>
			{children}
		</Box>
	);
}

export function PaperTextureLayer() {
	const texture = getTextureLayers();

	return (
		<Box
			position="absolute"
			inset={0}
			pointerEvents="none"
			opacity={texture.opacity}
			mixBlendMode={texture.mixBlendMode}
			backgroundImage={texture.backgroundImage.join(", ")}
			backgroundSize={texture.backgroundSize.join(", ")}
			backgroundRepeat={texture.backgroundRepeat.join(", ")}
			borderRadius="inherit"
			zIndex={0}
		/>
	);
}

export function PaperContent({ children }: { children: React.ReactNode }) {
	return (
		<Box position="relative" zIndex={1}>
			{children}
		</Box>
	);
}
