# @bc-news/fixtures

The skeleton walk feeds the committed BitJita wire corpus at
`bitjita/active-region-7_2026-08-24.json` through the stub, ingest worker, and
D1-backed generation path. The evidence corpus at
`evidence/active-region-7_2026-01-24.json` remains the representative
package-root fixture shorthand for full-evidence tests and context measurement.
`evidence/entity-reference-links.json` is the selected local-model entity
fixture and the current recorded-replay fixture for exact `[[GAME_REF_NNN]]`
coverage through the two writer prompts.
`evidence/game-reference-links.json` is the explicit focused-coordinate fixture
for coordinate-only replay and parser work that needs exact `[[GAME_REF_NNN]]`
coverage without BitJita entity resolution.
`evidence/game-reference-announcement-links.json` is the matching one-day public
slice for exercising an explicit completed milestone with a coordinate through
the announcements writer.
`bitjita/game-reference-resolutions.json` is the committed strict lookup roster
for the established item, cargo, claim, collectible, and resource names used by
fixture-backed eval and replay. Missing canonical identities deliberately
default to unknown rather than guessed names.
`fixtureEvidenceInput` still serves only the representative full-evidence
fixture. The recorded model provider remains deterministic. See
[evaluation operations](../../docs/evaluation-operations.md) for the commands
that consume or replace these fixtures.

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

`evidence/game-reference-links.json` — a focused-coordinate fixture for
publication date `2026-08-16`.

- **Source snapshot**: `apps/eval/local-data/corpus-workspaces/production-grounded-2026-08-16/snapshot.sqlite`.
- **Public rows retained verbatim**: exact `text`, `entity_id`, `timestamp_ts`,
  `username_raw`, and `username` values from public snapshot rows on
  `2026-08-15`, including `[Fire Nation](coord=7968,9659)`,
  `[Fire Nation T2 cave](coord=8014,9076)`, `[Fire nation T2 feeshery](coord=8058,9964)`,
  `Twaffles your trader stand over at this quarry needs more berserker pots :) (coord=3574,8848)`,
  `(coord=4786,9467)`, `I usually go north of Puerto Libre (coord=4692,9127)`,
  and the in-window boss exchange beginning with
  `anyone wanna help were almost at the boss(coord=7097,4729)` and ending with
  the exact public follow-up messages `damn just too late`, `thank you`, and
  `thanks :)`.
- **Synthetic composition**: the fixture deliberately combines exact public
  rows under one evidence date so one small committed corpus can cover labeled
  and bare coordinate forms without relying on production data.
- **Explicit synthetic rows**:
  `synthetic-game-reference-links-001` with `(coord=7968,9659)` is not a
  retained public message; it exists only to ground the
  same-coordinate/different-display token split that the replay and walk
  assert, with the bare form rendered as normalized coordinate text.
  `synthetic-game-reference-links-002` (`[Fire Nation] (coord=9001,9002)`),
  `synthetic-game-reference-links-003` (`[](coord=9003,9004)`),
  `synthetic-game-reference-links-004`
  (`https://example.test/?focus=(coord=9005,9006)`), and
  `synthetic-game-reference-links-005`
  (`[Map](https://example.test/?focus=(coord=9007,9008))`) are synthetic
  malformed and URL-smuggling counterexamples. They are committed only to prove
  those values stay out of the prepared game-reference roster and must never be
  described as retained public messages.
- **Selection rule**: callers must address this fixture by its explicit file
  path. The package-root shorthand stays pinned to
  `evidence/active-region-7_2026-01-24.json`.

`evidence/game-reference-announcement-links.json` retains five exact consecutive
public rows from region `7` on `2026-08-16`, including Dyrac's completed FIHS
Vulcano-light addition at `(coord=3862,4480)` and the immediate correction. It
contains no synthetic message and exists so local-model inspection can exercise
the announcements writer without turning a location request or plan into a
completed achievement.

`evidence/entity-reference-resource-region-9_2026-08-15.json` retains the exact
region `9` public resource exchange beginning with Beuwolf asking where to find
level 2 minerals and PussInBoots replying with `(res=1045808810)` at
`2026-08-15T22:28:07Z`. It keeps the adjacent exact public follow-up rows that
close the exchange and intentionally leaves `(res=1619369727)` unresolved in the
fixture-backed resolver roster.

`evidence/entity-reference-links.json` retains the exact region `9` public gear
discussion around Lintha's `(item=163977632)(item=264387410)(item=1122421091)`
row at `2026-08-16T10:46:47Z`. This is the selected local-model entity fixture:
it stays truthfully public, focused enough for a later manual checkpoint, and
contains one established resolved item plus neighboring unresolved item ids that
must remain inert.

`evidence/entity-reference-claim-region-12_2026-08-16.json` retains the exact
region `12` public invitation
`Everyone is welcome to come check out (claim=864691128594607212) its a work in progress still`
from ShadowTrip at `2026-08-16T13:01:37Z`. It is intentionally a one-row
focused fixture because the exact public claim row is the behavior under test.

`evidence/entity-reference-cargo-and-collectibles-region-18_2026-08-16.json`
retains the exact region `18` public cargo and collectible rows
`oiii :D (cargo=833769059)` from RoyalSailor at `2026-08-16T11:01:07Z` and
`(coll=381044074) + (coll=693157662) + (coll=1289105478)` from Geniewiz at
`2026-08-16T15:26:14Z`, along with the exact public explanatory lines that make
the collectible shorthand readable as a crafting-logistics exchange.

`evidence/entity-reference-synthetic.json` is synthetic only. It exists to keep
`know`, malformed numeric ids, and repeated canonical identities under test
without mislabeling them as public corpus evidence. Every row uses a
`synthetic/*` author id on purpose.

## Recorded model response provenance

The directory is one strict two-file unit, keyed by production step:
`main_story_write.json` and `announcements_write.json`. There is no copyedit
response, packaging response, or judge directory.

The current writer records are curated strict version 3 replay artifacts for
the two-writer topology. They preserve the retained editorial content that
still fits the current contract, are grounded against
`evidence/entity-reference-links.json`, and make their non-live provenance
explicit through their provider and model labels rather than implying a fresh
model recording. Historical absent-version records and version 2 responses
remain readable through the shared schema and tests, but they are no longer the
committed current replay shape. Every v3 response retains the exact adapter
configuration accepted for that production step: provider, model, optional
inference settings, reasoning declaration, and hosted billing evidence where
applicable.

For LM Studio, omission of `temperature`, `top_p`, `top_k`, or
`enable_thinking` means that exact field used its provider default for that run;
presence records the exact value sent. There is no run-wide sampling posture:
every production step and every field are independently configurable.

Obsolete decoding containers, invalid inference values, extra fields, and unknown
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
each production step's complete retained configuration.
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
fixtures or contacts a configured external model endpoint. The coordinate-only
fixture still carries its explicit synthetic terminals for the
same-coordinate/different-display proof, while the entity replay fixture stays
entirely on exact public region `9` item rows plus the committed BitJita name
roster.

Historical eval Run Files remain inert provenance only when reopened through a
historical reader from an explicit external path or prior Git commit; this repo
no longer tracks them in `HEAD`. Canonical replay checks current evidence and
final products without reconstructing prompt text or validating stored request
hashes. Recorded replay reports token measurement as unavailable and external
billing as none.
