-- Durable chat ingestion storage for the ingest Worker, which binds this
-- same database. The migration chain lives solely here — apps/ingest has no
-- migrations_dir of its own — so a serial resource keeps one owner.
CREATE TABLE chat_messages (
	entity_id     TEXT NOT NULL PRIMARY KEY,
	region_id     INTEGER NOT NULL,
	channel_id    INTEGER NOT NULL,
	target_id     TEXT,
	title_id      INTEGER,
	username_raw  TEXT NOT NULL,
	lang          TEXT,
	username      TEXT,
	text          TEXT NOT NULL,
	timestamp_utc TEXT NOT NULL,
	timestamp_ts  INTEGER NOT NULL,
	ingested_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Evidence reads are always "this active region, ordered by when it was
-- sent" — v1's channel_id index never served that read query.
CREATE INDEX idx_chat_messages_region_timestamp ON chat_messages (region_id, timestamp_ts);

-- One global watermark row per cursor key (the firehose is region-blind);
-- the poller's compare-and-set relies on this being the only row for a key.
CREATE TABLE poll_state (
	key        TEXT NOT NULL PRIMARY KEY,
	cursor_ts  INTEGER NOT NULL,
	updated_at TEXT NOT NULL
);
