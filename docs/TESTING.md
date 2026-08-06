---
type: doc
title: >-
  bc-news test and verification posture
description: >-
  The binding evidence discipline for bc-news v2 — what proves a change works, what the recorded replay proves, and what still requires representative model evaluation.
tags: [documentation, testing, verification, evaluation]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-06T19:06:47Z"
authority: binding
---

# bc-news test and verification posture

If implementation and this document disagree, the implementation is wrong
unless this document is deliberately amended in the same unit of work. Build
agents in this repo operate under the WSD standards discipline; this document
binds how that discipline's evidence domains apply to *this* project, so
"write a test" means one thing across every session.

## Separate verification domains

These surfaces answer different questions. None inherits another surface's
outcome or silently substitutes for it.

1. **Tests.** Deterministic isolated assertions protect warranted invariants,
   reproduced defects, and high-risk state transitions. A failing test is a
   hard failed test; it is not a retained model-evaluation attempt.
2. **Model evaluation.** `evaluate --fixture <path> --config <path>
   [--results-dir <path>]` observes one declared configuration and repetition.
   Its strict Benchmark Run retains every reached Step Invocation before
   transport and before parsing. Model rejection is a typed subject outcome
   and can coexist with `harness_outcome: retained`; invalid configuration or
   an untrustworthy create, write, or reparse is a harness failure and stops.
   Evaluation reports behavior, provenance, and deterministic findings without
   a judge, score, or acceptance verdict. Historical successful run files and
   context results keep their existing meanings.
3. **Recorded-replay acceptance.** The canonical recorded run executes the
   four dependent production steps twice. Results must be identical apart from
   run identity and timestamps, carry the exact ordered roster and usage, match
   parsed recorded responses, recompute request relations from the requests
   actually built, and assemble the final edition from the two copyedited
   products. This is an explicit acceptance gate over controlled evidence, not
   a live model evaluation. The composed recording probe uses a repository-owned
   loopback provider, validates request order and dependent copyedit inputs,
   stages and replays the exact four response files, and never contacts a
   configured endpoint or overwrites committed fixtures.
4. **The skeleton walk.** A fixed local conversation runs the whole pipeline:
   ingest into a fresh isolated D1 database; the real scheduled generation
   Workflow; `main_story_write`, `main_story_copyedit`,
   `announcements_write`, and `announcements_copyedit`; deterministic
   validation, assembly, and publication; the operator status projection; API
   read; and the published/unavailable/Back reader experience in installed
   Chrome. It uses exactly four recorded responses and no production data,
   live model, paid service, or external origin. The status proof requires all
   seven generation steps in order and exactly four ordered recorded-replay
   usage records at zero external billing. The served edition must equal the
   two copyedited products, derive grouped writer/copyeditor provenance from
   those four usages, and contain no internal announcement ids. Duplicate
   delivery must preserve edition bytes and usage, and an unknown pair must
   remain absent. Browser traffic is same-origin-only and exactly two
   pair-addressed edition 404s are allowed. This is the [PRD](PRD.md)'s first
   success signal and proves the composed deployable product. A passing test,
   retained Evaluation Trial, or acceptance gate cannot replace it.

**Static guarantees** support every domain. Strict TypeScript, lint, and zod
contracts parse-and-reject at every boundary; they do not prove runtime
behavior.

## What isolated tests defend here

Write one only when it earns its place:

- **Domain invariants** — the identity rules in the
  [domain model](DOMAIN.md): one region + date → one edition, no duplicate
  publication on retry, isolation of regional failure.
- **Date and window arithmetic** — publication-date and evidence-window
  logic; v1's calendar-date rejection lessons carry forward.
- **State transitions in the generation run** — resume-after-failure
  branching, durable-step semantics, anything where a wrong branch spends
  model money or duplicates an edition.
- **Reproduced bugs** — any failure observed in the running system gets a
  regression test when it is fixed.
- **Acceptance classification** — exact eval-field drift and browser
  request/response/error classification, where one permissive branch could
  certify a different product or an external call.

Never written: tests restating what the type system or a zod schema already
proves, tests of glue and framework wiring, tests to satisfy coverage.

## Rules

- Test names state the behavior under test, nothing else: `rejects rolled
  calendar date`, not "should correctly handle invalid dates".
- Fixtures are committed, deterministic, and shared between the eval
  harness and tests — one evidence corpus, not parallel ones.
- No live network or paid model calls inside tests; recorded responses or
  local models only.
- **A guard needs a reference independent of the thing it checks.** An
  assertion that recomputes both sides from the same input is a tautology
  however many layers separate them: it holds for every possible edit to that
  input and proves nothing. Relations recomputed from what the run consumed
  and produced are the right shape for the run's *own* fields.
- **Recorded artifacts are inputs, not byte-level expectations.** Canonical
  acceptance recomputes relations from the current evidence, the exported
  prompt builders, the recorded responses, and the run being checked. The
  recorder writes `prompt_sha256` from the request it actually sends, binding
  that recorded response to that request. The current committed writer
  responses are migrated fixtures and the copyedit responses are synthetic
  fixtures; their stamps are reconstructed request associations, not
  recorder-authored provenance. No stamp is durable proof that a particular
  model authored the response text. Editing a recorder-authored stamp by hand
  asserts provenance that never happened and is never a fix for a red gate.
- **Over-broad source digests are provenance, not gates.** Source fingerprints,
  `code_version`, and retained run-file bytes may remain comparison evidence,
  but never become acceptance pins. A guard that fires because unrelated source
  text moved carries no useful product information.
- Determinism is proved by re-executing the canonical run rather than against
  a stored file. The canonical comparison reports every differing field except
  `id`, `started_at`, and `completed_at`.
- Canonical eval verification parses every run it produces with the strict run
  schema. The permissive historical loader and the human comparison report are
  not acceptance gates.
- Versioned model-evaluation artifacts validate against their own frozen
  semantics. Version 1 rejects changed contract representations or hashes,
  prepared-evidence snapshots that no longer match their identity and summary,
  writer requests that do not exactly match the v1-local prompt and transcript
  derived from that snapshot, impossible timestamp or duration relations, and
  fabricated, missing, extra, or drifted final-product findings. Tests also
  force a failure after temporary-file write but before rename and require
  unchanged authoritative bytes. They separately prove successful cleanup and
  prove that an OS cleanup failure stays an explicit harness failure carrying
  the temporary path while preserving the primary `write_rejected` cause. V1
  validation does not call mutable production parsers, prompt builders,
  fencing, or product checks when re-validating historical evidence.
- V1 code provenance is the clean repository commit itself: repository name,
  validated 40-character commit SHA, and `dirty: false`. Strict validation
  rejects missing, malformed, or extra provenance fields rather than retaining
  a redundant workspace hash.
- The active generator and canonical acceptance have no automatic model judge,
  score, verdict, quality floor, threshold, or byte-pinned baseline.
- Copyedit preservation checks can prove only their mechanical invariants:
  announcement identity/order, paragraph count, quotes, numeric literals,
  and protected markdown spans. They cannot prove semantic equivalence or prose
  quality. Representative live-model evaluation remains required before model,
  prompt, or evidence-policy decisions are treated as production-ready.
- Exact context-budget measurement runs through
  `pnpm --filter @bc-news/eval eval -- context --fixture packages/fixtures`.
  Automated tests use a fake local runtime and fake completion endpoint; they
  never invoke LM Studio. The accepted representative run requires exactly one
  already-loaded local Qwen model, rejects any hosted or mixed-model config,
  and never loads, unloads, or switches model state.
- The canonical corpus prepares to 208 messages under the unchanged production
  sampler, so the truthful representative matrix is 1, 50, 100, 150, and 208.
  The benchmark records the corpus hash and ceiling; it does not pad or duplicate
  messages to manufacture a 300-message row. The production baseline remains at
  most 300 messages, at most 13 from each UTC hour, stable FNV selection from
  `activeRegionId|publicationDate|message.id`, and truthful `sampling_dropped`
  accounting. No filtering, retrieval, or chunking policy changes here.
- Each benchmark row retains the exact production request hash, structured-output
  schema hash, loaded model context length, fixed templated input, evidence or
  draft marginal, any nonnegative provider/runtime delta, provider-reported
  input and completion usage, total, and remaining headroom. Component sums and
  model identity are rejecting contracts; unsupported attribution is never
  estimated.
- The live recorder requires an explicit four-step live eval configuration and
  performs four dependent calls. It stages and validates the exact four-file
  set on the target filesystem, replays the staged records through the shared
  runner, compares only the final editorial products, and promotes the response
  directory all-or-none with recoverable backup handling. It does not promise
  continuous visibility to concurrent readers and has no judge, threshold,
  byte pin, or source-digest acceptance gate. The walk exercises this contract
  against its own loopback provider and temporary output; overwriting committed
  response fixtures remains an explicit developer `record` operation.
- Completion claims cite the tier that proved them. "Done" without evidence
  from tier 1–3 is not done.

## Links

- [Product requirements](PRD.md) — binds evaluation-led development and the
  skeleton-walk success signal.
- [Structural discipline](ARCHITECTURE.md) — the ports and boundary rules
  the tiers exercise.
- [Domain model](DOMAIN.md) — the invariants tier-4 tests defend.
