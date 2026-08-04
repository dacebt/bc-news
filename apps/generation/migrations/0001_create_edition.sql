-- One row per published edition; the pair primary key is the authoritative
-- guarantee that one active region and one publication date identify at most
-- one edition, regardless of duplicate generation runs.
CREATE TABLE edition (
	active_region_id TEXT NOT NULL,
	publication_date TEXT NOT NULL,
	status           TEXT NOT NULL CHECK (status IN ('published')),
	document_json    TEXT NOT NULL,
	published_at_utc TEXT NOT NULL,
	PRIMARY KEY (active_region_id, publication_date)
);
