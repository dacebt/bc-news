CREATE TABLE generation_run_status (
	active_region_id     TEXT NOT NULL,
	publication_date     TEXT NOT NULL,
	state                TEXT NOT NULL CHECK (state IN ('queued', 'running', 'complete', 'errored')),
	current_step         TEXT CHECK (
		current_step IS NULL OR current_step IN (
			'prepare-evidence',
			'compose-main-story',
			'compose-announcements',
			'compose-packaging',
			'validate-edition',
			'publish-edition'
		)
	),
	completed_steps_json TEXT NOT NULL CHECK (json_valid(completed_steps_json)),
	model_usage_json     TEXT NOT NULL CHECK (json_valid(model_usage_json)),
	failure_json         TEXT CHECK (failure_json IS NULL OR json_valid(failure_json)),
	created_at_utc       TEXT NOT NULL,
	updated_at_utc       TEXT NOT NULL,
	PRIMARY KEY (active_region_id, publication_date),
	CHECK (
		(state = 'running' AND current_step IS NOT NULL) OR
		(state <> 'running' AND current_step IS NULL)
	),
	CHECK (
		(state = 'errored' AND failure_json IS NOT NULL) OR
		(state <> 'errored' AND failure_json IS NULL)
	)
);
