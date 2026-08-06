# @bc-news/fixtures

The skeleton walk feeds the committed BitJita wire corpus at
`bitjita/active-region-7_2026-01-24.json` through the stub, ingest worker, and
D1-backed generation path. The evidence corpus at
`evidence/active-region-7_2026-01-24.json` feeds the explicitly selected
`fixtureEvidenceInput` adapter for tests and evaluation. The recorded model
provider remains deterministic.

## Evidence fixture provenance

`evidence/active-region-7_2026-01-24.json` — 630 messages for active region
`7` on evidence date `2026-01-24` (UTC).

- **Source repo**: `bc-news-worker` (frozen v1 monorepo, read-only reference),
  commit `94b5174`.
- **Source file**: `apps/eval/fixtures/raw_messages/messages_2026-01-24.json`
  (gitignored in v1; single local-disk copy).
- **Filter**: flatten every page's `results[]`; keep rows with
  `region_id === 7` and `timestamp_ts` in
  `[2026-01-24T00:00:00Z, 2026-01-25T00:00:00Z)` (end-exclusive).
- **Mapping**: `id ← entity_id`, `ts ← timestamp_ts`,
  `author_id ← username_raw`, `author_name ← username`, `text ← text`;
  sorted by `(ts, id)`. One deliberate boundary-contract probe changes only
  message `504403158437419536` (`en/Aryn`, `k`, timestamp `1769285267000`)
  from source author name `Aryn` to `null`; the derivation fails if that exact
  source row drifts and preserves any ordinary source nulls unchanged.
- **Derivation**: `scripts/derive-evidence-fixture.ts`, run once via
  `pnpm --filter @bc-news/fixtures derive-evidence-fixture <source-file>`.
  The script validates the envelope against `EvidenceFixtureSchema` and
  refuses to write output above 250 KB. The committed JSON is canonical; the
  script is provenance.

The v1 `prep_output_*.json` files were deliberately not reused (dead
Python-era mapping); deterministic preparation recomputes everything
downstream of this corpus.

## Recorded model response provenance

The directory is one strict four-file unit, keyed by production step:
`main_story_write.json`, `main_story_copyedit.json`,
`announcements_write.json`, and `announcements_copyedit.json`. There is no
packaging response and no judge directory.

The writer records migrate retained v1 editorial content. The main-story
record combines the old story with the old deterministic-packaging title and
subtitle. The copyedit records are explicitly synthetic preservation copies,
not newly generated Qwen output. Their provider and model labels make that
provenance visible rather than implying a live re-record occurred.

`prompt_sha256` binds a record to the exact `{system, user}` request rebuilt
from current builders and dependent upstream output. Replay selection remains
keyed by `production_step`; canonical verification recomputes every stamp.
The hash is request provenance, not proof that a named model authored text.

The eval recorder requires an explicit live four-step configuration. It makes
the four dependent production calls, writes each exact
`(production_step, prompt_sha256)` association into a same-filesystem staging
directory, validates and replays the complete staged roster, and compares only
the final main-story and announcements products before recoverable all-or-none
directory promotion. Promotion does not promise continuous visibility to
concurrent readers. There is no judge, threshold, byte pin, or source-digest
acceptance gate.

Committed files in `model-responses/` are overwritten only when a developer
explicitly runs the `record` command with that directory as the target. The
canonical walk records into its own temporary directory through a
repository-owned loopback provider; it never changes the committed fixtures or
contacts a configured external endpoint.

Retained historical eval run files remain human-readable provenance only.
Canonical replay instead recomputes relationships from current evidence,
prompt builders, the four records, and the run being checked. Recorded replay
reports token measurement as unavailable and external billing as none.
