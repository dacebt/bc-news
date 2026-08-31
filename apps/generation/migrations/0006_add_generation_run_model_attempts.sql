CREATE TABLE generation_run_status_next (
	contract_version     TEXT CHECK (
		contract_version IS NULL OR contract_version IN ('current_v1', 'current_v2')
	),
	active_region_id     TEXT NOT NULL,
	publication_date     TEXT NOT NULL,
	state                TEXT NOT NULL CHECK (state IN ('queued', 'running', 'complete', 'errored')),
	current_step         TEXT CHECK (
		current_step IS NULL OR current_step IN (
			'prepare-evidence',
			'main_story_write',
			'main_story_copyedit',
			'announcements_write',
			'announcements_copyedit',
			'validate-edition',
			'publish-edition'
		)
	),
	completed_steps_json TEXT NOT NULL CHECK (json_valid(completed_steps_json)),
	model_usage_json     TEXT NOT NULL CHECK (json_valid(model_usage_json)),
	model_attempts_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(model_attempts_json)),
	diagnostics_json     TEXT NOT NULL CHECK (json_valid(diagnostics_json)),
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

INSERT INTO generation_run_status_next (
	contract_version,
	active_region_id,
	publication_date,
	state,
	current_step,
	completed_steps_json,
	model_usage_json,
	model_attempts_json,
	diagnostics_json,
	failure_json,
	created_at_utc,
	updated_at_utc
)
SELECT
	contract_version,
	active_region_id,
	publication_date,
	state,
	current_step,
	completed_steps_json,
	model_usage_json,
	'[]',
	diagnostics_json,
	failure_json,
	created_at_utc,
	updated_at_utc
FROM generation_run_status;

DROP TABLE generation_run_status;
ALTER TABLE generation_run_status_next RENAME TO generation_run_status;
