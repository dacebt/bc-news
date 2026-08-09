ALTER TABLE generation_run_status
	ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json));
