export const CONTENT_SECURITY_POLICY =
	"default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'none'";

export const PERMISSIONS_POLICY =
	"accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()";

export function withDynamicSecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
	headers.set("Permissions-Policy", PERMISSIONS_POLICY);
	headers.set("Referrer-Policy", "no-referrer");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Frame-Options", "DENY");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
