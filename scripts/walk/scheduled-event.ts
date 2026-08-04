export interface ScheduledEventResult {
	status: number;
	body: string;
}

export async function dispatchScheduledEvent(
	baseUrl: string,
	cron: string,
	scheduledTime: number,
): Promise<ScheduledEventResult> {
	const url = new URL("/cdn-cgi/local/scheduled", baseUrl);
	url.searchParams.set("cron", cron);
	url.searchParams.set("time", String(scheduledTime));
	const response = await fetch(url);
	return { status: response.status, body: await response.text() };
}
