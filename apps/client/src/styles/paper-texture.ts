const TEXTURE = {
	FIBER_OPACITY: 0.08,
	FINE_GRAIN_OPACITY: 0.35,
	COARSE_GRAIN_OPACITY: 0.18,
	VIGNETTE_OPACITY: 0.05,
	FINE_GRAIN_SIZE: "200px 200px",
	COARSE_GRAIN_SIZE: "400px 400px",
	FIBER_SIZE: "2px 2px",
	OVERALL_OPACITY: 0.45,
} as const;

function paperGrainTexture(variant: "fine" | "coarse", opacity: number): string {
	const baseFrequency = variant === "fine" ? "1.0" : "0.35";
	const numOctaves = variant === "fine" ? "4" : "2";
	const size = variant === "fine" ? "128" : "256";
	const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="grain-${variant}" x="0%" y="0%" width="100%" height="100%"><feTurbulence baseFrequency="${baseFrequency}" numOctaves="${numOctaves}" stitchTiles="stitch" type="fractalNoise"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="100%" height="100%" filter="url(#grain-${variant})" opacity="${opacity}"/></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface TextureLayers {
	backgroundImage: string[];
	backgroundSize: string[];
	backgroundRepeat: string[];
	opacity: number;
	mixBlendMode: "multiply";
}

export function getTextureLayers(): TextureLayers {
	const fiberLayer = `repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0, 0, 0, ${TEXTURE.FIBER_OPACITY}) 1px, rgba(0, 0, 0, ${TEXTURE.FIBER_OPACITY}) 2px)`;
	const vignetteLayer = `radial-gradient(ellipse at center, transparent 0%, rgba(0, 0, 0, ${TEXTURE.VIGNETTE_OPACITY}) 100%)`;
	const halftoneSvg = `<svg width="4" height="4" xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="0.8" fill="black" opacity="0.12"/></svg>`;
	const halftonePattern = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(halftoneSvg)}`;

	return {
		backgroundImage: [
			paperGrainTexture("fine", TEXTURE.FINE_GRAIN_OPACITY),
			paperGrainTexture("coarse", TEXTURE.COARSE_GRAIN_OPACITY),
			halftonePattern,
			fiberLayer,
			vignetteLayer,
		],
		backgroundSize: [
			TEXTURE.FINE_GRAIN_SIZE,
			TEXTURE.COARSE_GRAIN_SIZE,
			"4px 4px",
			TEXTURE.FIBER_SIZE,
			"100% 100%",
		],
		backgroundRepeat: ["repeat", "repeat", "repeat", "repeat", "no-repeat"],
		opacity: TEXTURE.OVERALL_OPACITY,
		mixBlendMode: "multiply",
	};
}
