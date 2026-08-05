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

`model-responses/main_story.json` — the recorded `main_story` editorial
capability response. The story text was authored by hand from the actual
region-7 2026-01-24 conversation in v1's editorial voice (every quotation
verified verbatim against the prepared evidence); it parses against the
capability's output contract (`MainStoryOutputSchema`). For capability records,
`prompt_sha256` is the SHA-256 of the exact user-prompt UTF-8 bytes built from
this corpus at authoring time (judge records separately hash their established
`{system,user}` request) —
informational provenance only, never branched on: responses are keyed by
editorial capability alone so prompt edits do not break the walk.
