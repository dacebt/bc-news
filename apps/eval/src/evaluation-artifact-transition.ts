import type {
	BenchmarkRun,
	GatewayRequestRecord,
	RuntimeEvidenceRecord,
	V7BenchmarkRun,
	V8BenchmarkRun,
} from "./evaluation-artifact";

type TransitionTrial = BenchmarkRun["trials"][number];
type TransitionInvocation = TransitionTrial["invocations"][number];

function equal(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function requireEqual(left: unknown, right: unknown, label: string): void {
	if (!equal(left, right)) throw new Error(`${label} is immutable`);
}

function invocationBase(invocation: TransitionInvocation): Record<string, unknown> {
	return {
		id: invocation.id,
		production_step: invocation.production_step,
		config_identity: invocation.config_identity,
		ordinal: invocation.ordinal,
		predecessor_invocation_id: invocation.predecessor_invocation_id,
		request: invocation.request,
		request_sha256: invocation.request_sha256,
		started_at: invocation.started_at,
	};
}

function withoutParse(invocation: TransitionInvocation): unknown {
	if (invocation.transport !== "succeeded") return invocation;
	return {
		...invocationBase(invocation),
		transport: invocation.transport,
		completion: invocation.completion,
		ended_at: invocation.ended_at,
		duration_ms: invocation.duration_ms,
	};
}

function withoutRetryClassification(invocation: TransitionInvocation): unknown {
	if (invocation.transport !== "failed") return invocation;
	return {
		...invocationBase(invocation),
		transport: invocation.transport,
		failure: invocation.failure,
		ended_at: invocation.ended_at,
		duration_ms: invocation.duration_ms,
		parse: invocation.parse,
	};
}

function validateInvocationTransition(
	current: TransitionInvocation,
	next: TransitionInvocation,
): void {
	requireEqual(invocationBase(current), invocationBase(next), `invocation ${current.id} identity and request evidence`);
	if (current.transport === "in_flight" && next.transport === "succeeded" && next.parse.state === "pending") return;
	if (current.transport === "in_flight" && next.transport === "failed" && next.retry_classification.state === "pending") return;
	if (current.transport === "succeeded" && current.parse.state === "pending" && next.transport === "succeeded" && (next.parse.state === "succeeded" || next.parse.state === "rejected")) {
		requireEqual(withoutParse(current), withoutParse(next), `invocation ${current.id} transport evidence`);
		return;
	}
	if (current.transport === "failed" && current.retry_classification.state === "pending" && next.transport === "failed" && next.retry_classification.state === "classified") {
		requireEqual(withoutRetryClassification(current), withoutRetryClassification(next), `invocation ${current.id} failure evidence`);
		return;
	}
	requireEqual(current, next, `invocation ${current.id}`);
}

function validateTrackTransition(
	current: TransitionTrial["tracks"]["main_story"],
	next: TransitionTrial["tracks"]["main_story"],
	name: string,
): void {
	if (equal(current, next)) return;
	if (current.lifecycle === "pending" && next.lifecycle === "running") return;
	if (current.lifecycle === "running" && (next.lifecycle === "completed" || next.lifecycle === "rejected")) return;
	throw new Error(`${name} track transition ${current.lifecycle} -> ${next.lifecycle} is not monotonic`);
}

function validateTrialTransition(
	current: TransitionTrial,
	next: TransitionTrial,
): void {
	requireEqual(
		{ id: current.id, config_identity: current.config_identity, repetition: current.repetition, started_at: current.started_at },
		{ id: next.id, config_identity: next.config_identity, repetition: next.repetition, started_at: next.started_at },
		"trial identity, configuration, and start",
	);
	if (current.lifecycle === "complete") requireEqual(current, next, "complete trial");
	if (current.lifecycle === "running" && next.lifecycle !== "running" && next.lifecycle !== "complete") throw new Error("trial transition is not monotonic");
	if (current.lifecycle === "running" && next.lifecycle === "running") {
		requireEqual(current.completed_at, next.completed_at, "running trial completion time");
		requireEqual(current.subject_outcome, next.subject_outcome, "running trial outcome");
	}

	if (next.invocations.length < current.invocations.length || next.invocations.length > current.invocations.length + 1) throw new Error("invocations may append exactly one entry and may never be removed");
	for (const [index, invocation] of current.invocations.entries()) validateInvocationTransition(invocation, next.invocations[index]!);
	if (next.invocations.length === current.invocations.length + 1) {
		const appended = next.invocations.at(-1)!;
		if (appended.transport !== "in_flight" || appended.ordinal !== current.invocations.length + 1) throw new Error("appended invocation must be the next contiguous in-flight invocation");
	}

	for (const step of Object.keys(current.selected_invocation_ids) as Array<keyof typeof current.selected_invocation_ids>) {
		const selected = current.selected_invocation_ids[step];
		const nextSelected = next.selected_invocation_ids[step];
		if (selected !== null) requireEqual(selected, nextSelected, `${step} selected invocation`);
	}
	validateTrackTransition(current.tracks.main_story, next.tracks.main_story, "main_story");
	validateTrackTransition(current.tracks.announcements, next.tracks.announcements, "announcements");
}

function validateRuntimeEvidenceTransition(current: V7BenchmarkRun | V8BenchmarkRun | Extract<BenchmarkRun, { version: 9 }>, next: V7BenchmarkRun | V8BenchmarkRun | Extract<BenchmarkRun, { version: 9 }>): void {
	if (next.runtime_evidence.length < current.runtime_evidence.length
		|| next.runtime_evidence.length > current.runtime_evidence.length + 1) {
		throw new Error("runtime evidence may append exactly one pending entry and may never be removed");
	}
	for (const [index, evidence] of current.runtime_evidence.entries()) {
		const nextEvidence = next.runtime_evidence[index]!;
		const identity = (record: RuntimeEvidenceRecord) => ({
			trial_id: record.trial_id,
			invocation_id: record.invocation_id,
			config_identity: record.config_identity,
			production_step: record.production_step,
			ordinal: record.ordinal,
		});
		requireEqual(identity(evidence), identity(nextEvidence), `runtime evidence ${evidence.invocation_id} identity`);
		if (evidence.state === "pending" && (nextEvidence.state === "captured" || nextEvidence.state === "unavailable")) continue;
		requireEqual(evidence, nextEvidence, `resolved runtime evidence ${evidence.invocation_id}`);
	}
	if (next.runtime_evidence.length === current.runtime_evidence.length + 1) {
		const appended = next.runtime_evidence.at(-1)!;
		if (appended.state !== "pending") throw new Error("appended runtime evidence must begin pending");
	}
}

function validateGatewayRequestTransition(current: V8BenchmarkRun | Extract<BenchmarkRun, { version: 9 }>, next: V8BenchmarkRun | Extract<BenchmarkRun, { version: 9 }>): void {
	if (next.gateway_requests.length < current.gateway_requests.length
		|| next.gateway_requests.length > current.gateway_requests.length + 1) {
		throw new Error("Gateway request evidence may append exactly one pending entry and may never be removed");
	}
	for (const [index, record] of current.gateway_requests.entries()) {
		const nextRecord = next.gateway_requests[index]!;
		const identity = (candidate: GatewayRequestRecord) => ({
			trial_id: candidate.trial_id,
			invocation_id: candidate.invocation_id,
			config_identity: candidate.config_identity,
			production_step: candidate.production_step,
			ordinal: candidate.ordinal,
		});
		requireEqual(identity(record), identity(nextRecord), `Gateway request ${record.invocation_id} identity`);
		if (record.state === "pending" && nextRecord.state !== "pending") continue;
		requireEqual(record, nextRecord, `resolved Gateway request ${record.invocation_id}`);
	}
	if (next.gateway_requests.length === current.gateway_requests.length + 1) {
		const appended = next.gateway_requests.at(-1)!;
		if (appended.state !== "pending") throw new Error("appended Gateway request evidence must begin pending");
	}
}

export function validateBenchmarkRunTransition(current: BenchmarkRun, next: BenchmarkRun): void {
	if (current.lifecycle === "complete") throw new Error("complete benchmark artifacts are immutable");
	requireEqual(
		{
			version: current.version,
			id: current.id,
			started_at: current.started_at,
			declaration: current.declaration,
			fixture: current.fixture,
			prepared_evidence: current.prepared_evidence,
			provenance: current.provenance,
			trial_roster: current.trial_roster,
		},
		{
			version: next.version,
			id: next.id,
			started_at: next.started_at,
			declaration: next.declaration,
			fixture: next.fixture,
			prepared_evidence: next.prepared_evidence,
			provenance: next.provenance,
			trial_roster: next.trial_roster,
		},
		"benchmark identity, declaration, fixture, prepared evidence, provenance, and roster",
	);
	if (next.lifecycle !== "running" && next.lifecycle !== "complete") throw new Error("benchmark transition is not monotonic");
	if (current.version !== next.version) throw new Error("benchmark artifact version is immutable");
	if (next.trials.length < current.trials.length || next.trials.length > current.trials.length + 1) throw new Error("trials may append exactly one roster member and may never be removed");
	for (const [index, trial] of current.trials.entries()) validateTrialTransition(trial, next.trials[index]!);
	if (next.trials.length === current.trials.length + 1) {
		if (current.trials.at(-1)?.lifecycle === "running") throw new Error("a new trial cannot append while the previous trial is running");
		const appended = next.trials.at(-1)!;
		if (appended.lifecycle !== "running" || appended.invocations.length !== 0) throw new Error("an appended trial must begin running without invocations");
	}
	if (current.version === 7 && next.version === 7) validateRuntimeEvidenceTransition(current, next);
	if ((current.version === 8 || current.version === 9) && current.version === next.version) {
		validateRuntimeEvidenceTransition(current, next);
		validateGatewayRequestTransition(current, next);
	}
}
