/**
 * The one definition of a recorded prompt stamp. The `{system, user}` envelope is hashed
 * because that is what was actually sent: hashing the user prompt alone let a
 * SYSTEM_CONSTRAINTS edit leave every stamp reporting "unchanged" while the
 * model received a different request.
 */
export async function modelRequestSha256(request: {
	readonly system: string;
	readonly user: string;
}): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify({ system: request.system, user: request.user }));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
