# @bc-news/fixtures

The skeleton walk feeds the committed BitJita wire corpus at
`bitjita/active-region-7_2026-01-24.json` through the stub, ingest worker, and
D1-backed generation path. The evidence corpus at
`evidence/active-region-7_2026-01-24.json` feeds the explicitly selected
`fixtureEvidenceInput` adapter for tests and evaluation. The recorded model
provider remains deterministic. See [evaluation operations](../../docs/evaluation-operations.md)
for the commands that consume or replace these fixtures.

## Evidence fixture provenance

`evidence/active-region-7_2026-01-24.json` — 630 messages for active region
`7` on evidence date `2026-01-24` (UTC).

- **Source repo**: `bc-news-worker` (frozen v1 monorepo, read-only reference),
  commit `94b5174`; this identifies the derivation environment, not retained
  source bytes.
- **Source file**: `apps/eval/fixtures/raw_messages/messages_2026-01-24.json`
  (gitignored in v1). The original untracked source bytes are not retained in
  this repository, so a clean clone cannot reproduce the derivation from the
  commit alone.
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
  refuses to write output above 250 KB. The committed derived JSON is the
  canonical fixture; the script records the transformation but is not a
  reproducibility guarantee without the original source bytes.

The v1 `prep_output_*.json` files were deliberately not reused (dead
Python-era mapping); deterministic preparation recomputes everything
downstream of this corpus.

## Recorded model response provenance

The directory is one strict two-file unit, keyed by production step:
`main_story_write.json` and `announcements_write.json`. There is no copyedit
response, packaging response, or judge directory.

The current writer records are curated schema-valid replay artifacts for the
two-writer topology. They preserve the retained editorial content that still
fits the current contract and make their non-live provenance explicit through
their provider and model labels rather than implying a fresh model recording.

Committed absent-version records remain the strict legacy response contract
and replay unchanged. Version 2 remains a frozen historical contract with its
former provider-default or complete `temperature`/`top_p`/`top_k` sampling
evidence. The current recorder writes strict response version 3. Every v3
response retains the exact adapter configuration accepted for that production
step: provider, model, optional temperature, reasoning declaration, and hosted
billing evidence where applicable.

Temperature omission means that exact production model step used its provider
default for that run. Temperature presence records the exact value sent. Current configuration
does not admit or send `top_p` or `top_k`, and there is no run-wide sampling
posture: every production step is independently configurable.

Obsolete decoding fields, invalid temperatures, extra fields, and unknown
versions reject at the current response boundary. Configuration is retained
evidence; the recorded provider never applies it during replay.

`prompt_sha256` is inert request-observation metadata. Replay selection remains
keyed by `production_step`; no verifier rebuilds prompt text or compares current
prompt bytes with a retained hash. The hash is not a development gate or proof
that a named model authored text.

The eval recorder requires an explicit live two-step configuration. It makes
the two dependent production calls and writes each production step's response,
observed request hash, and v3 production-step configuration into a
same-filesystem staging directory, validates and replays the complete staged
roster, and compares only the final main-story and announcements products
before recoverable all-or-none directory promotion. The command report lists
each production step's retained model and optional temperature.
Only one recorder may own a response directory at a time. A concurrent recorder
is rejected; one stale owner may be quarantined before recovery, and a recorder
whose lock ownership changes cannot release the replacement owner's lock.
Promotion does not promise continuous visibility to concurrent readers. There
is no judge, threshold, byte pin, or source-digest acceptance gate.

The current recorder accepts LM Studio and the legacy OpenAI-compatible hosted
adapter. It rejects `recorded` and `cloudflare_ai_gateway` configurations;
Gateway benchmarks retain a different evidence contract.

Committed files in `model-responses/` are overwritten only when a developer
explicitly runs `fixture record-responses` with that directory as the target.
The canonical walk reads the committed responses through the recorded adapter,
uses an isolated temporary D1 database, and never changes the committed
fixtures or contacts a configured external model endpoint.

Historical eval Run Files remain inert provenance only when reopened through a
historical reader from an explicit external path or prior Git commit; this repo
no longer tracks them in `HEAD`. Canonical replay checks current evidence and
final products without reconstructing prompt text or validating stored request
hashes. Recorded replay reports token measurement as unavailable and external
billing as none.
