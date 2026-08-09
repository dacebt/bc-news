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
subtitle. The copyedit records are explicitly synthetic schema-valid products,
not newly generated Qwen output. The main-story copyedit deliberately changes a
number inside one quote and contains an em dash so the composed
recorded-provider path retains exact preservation and final-product diagnostics
while still publishing the copyedited product. Their provider and model labels
make that provenance visible rather than implying a live re-record occurred.

Committed absent-version records remain the strict legacy response contract
and replay unchanged. Version 2 remains a frozen historical contract with its
former provider-default or complete `temperature`/`top_p`/`top_k` sampling
evidence. The current recorder writes strict response version 3. Every v3
response retains the exact adapter configuration accepted for that production
step: provider, model, optional temperature, reasoning declaration, and hosted
billing evidence where applicable.

Temperature omission means that exact agent used its provider default for that
run. Temperature presence records the exact value sent. Current configuration
does not admit or send `top_p` or `top_k`, and there is no run-wide sampling
posture: every production step is independently configurable.

Obsolete decoding fields, invalid temperatures, extra fields, and unknown
versions reject at the current response boundary. Configuration is retained
evidence; the recorded provider never applies it during replay.

`prompt_sha256` binds a record to the exact `{system, user}` request rebuilt
from current builders and dependent upstream output. Replay selection remains
keyed by `production_step`; canonical verification recomputes every stamp.
The hash is request provenance, not proof that a named model authored text.

The eval recorder requires an explicit live four-step configuration. It makes
the four dependent production calls, writes each exact
`(production_step, prompt_sha256)` association and v3 agent configuration into a
same-filesystem staging directory, validates and replays the complete staged
roster, and compares only the final main-story and announcements products
before recoverable all-or-none directory promotion. The command report lists
each production step's retained model and optional temperature.
Promotion does not promise continuous visibility to concurrent readers. There
is no judge, threshold, byte pin, or source-digest acceptance gate.

Committed files in `model-responses/` are overwritten only when a developer
explicitly runs the `record` command with that directory as the target. The
canonical walk records into its own temporary directory through a
repository-owned loopback provider; it never changes the committed fixtures or
contacts a configured external endpoint.

Retained historical eval run files remain human-readable provenance only.
Canonical replay instead recomputes relationships from current evidence,
prompt builders, the four records, and the run being checked. Recorded replay
reports token measurement as unavailable and external billing as none.
