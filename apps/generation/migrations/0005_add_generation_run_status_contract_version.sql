ALTER TABLE generation_run_status
	ADD COLUMN contract_version TEXT CHECK (contract_version IS NULL OR contract_version = 'current_v1');
