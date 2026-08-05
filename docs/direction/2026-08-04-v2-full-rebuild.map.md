---
type: capability-map
title: >-
  Capability map: v2 full rebuild
description: >-
  The carve of the bc-news v2 rebuild into ordered vertical capabilities — from the completed walking skeleton to the full pre-deployment product — plus the conventions the rebuild introduces.
tags: [wsd, direction, capability-map]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-04T12:44:48Z"
---
# Capability map: v2 full rebuild

Vocabulary lives in the binding [domain model](../DOMAIN.md); this map pins patterns and the carve only. Capability roster naming is settled by DOMAIN.md amendment in the slice that builds it, never here.

## New conventions

1. **Editorial capability module pattern.** Each editorial capability is one module `packages/generation-core/src/<capability>.ts` exporting its prompt builder, strict output schema, and rejecting parser — the shape `main-story.ts` established. Capability ids are snake_case DOMAIN terms used verbatim in `MODEL_CONFIG`, `meta.editorial_capabilities`, and recorded-response files.
2. **Recorded model responses.** One JSON per capability at `packages/fixtures/model-responses/<capability>.json`, validated by `RecordedModelResponseSchema`; `prompt_sha256` is provenance, never branched on.
3. **Model/provider dispatch.** Generation and eval map each capability id, and eval maps its judge, to a strict adapter config selecting `recorded`, `lmstudio`, or `openai_compatible_hosted`; thin role-aware resolvers dispatch through the existing model-provider port. Local and hosted inference share one strict OpenAI-compatible infrastructure transport. Hosted endpoint and credential stay environment-only, while non-secret provider/model identity and pricing-reference inputs remain fingerprintable configuration.
4. **Recorded BitJita fixtures.** Ingest's local evidence is recorded BitJita API responses under `packages/fixtures/bitjita/`, committed and deterministic, shared by tests and the walk — one corpus, no parallel ones.

## Capabilities

1. ~~**Walking skeleton**~~ — done 2026-08-04 (`0ef8ea9..7a9eb9c`): fixture chat in, main_story edition out, client renders it, `pnpm walk` green.
2. **Config-dispatched ports** — the generation Worker resolves the evidence adapter and each capability's model provider from validated config; a config change alone switches adapters, and invalid config rejects loudly. (Also modularizes the walk runner into composable phase files so later capabilities add assertions without contending on one script.) The seam every later capability plugs into — first for that reason.
3. **Evidence integrity** — the functional core itself enforces the evidence-date window and a total deterministic order (tie-break beyond `(ts, id)` collisions); nullable `author_name` is exercised by the corpus. Closes the skeleton review's core follow-ups.
4. **Announcements & achievements** — the edition carries model-generated announcements grounded in the evidence (v1 stage 1, prompts near-verbatim); the client's populated announcements branch renders them. Client markdown-security dedup rides here (it touches the same rendering seam).
5. **Packaging** — the edition's presentation fields are produced by the packaging capability (v1 stage 3), replacing the skeleton's deterministic masthead fills; DOMAIN.md's skeleton-fill default is amended out in the same unit.
6. **Local and hosted model providers** — one strict OpenAI-compatible infrastructure adapter behind the existing model port supports LM Studio and generic hosted inference across generation and eval. A developer switches every capability and the eval judge independently by config; hosted runs retain provider-reported usage and pricing-reference-calculated cost. The atomic re-record path accepts either live adapter, while all automated verification uses the repository-owned loopback server and makes no live call.
7. **Ingest** — the ingest app polls BitJita (recorded fixture responses locally), validates at the boundary, and stores chat durably in D1 under v1's cursor/watermark discipline; an operator can see what a poll ingested.
8. **Evidence from ingested storage** — a generation run draws its evidence from ingest's D1 storage through the same evidence port the fixtures use; an edition is generated locally from ingested rows, not the fixture file.
9. **Scheduling** — cron-driven entries collect evidence and then identify active regions from their one authoritative home, starting one generation run per (active region, publication date); missing-data behavior follows v1's default. Local walk exercises both real scheduled paths by hand-invoking them.
10. **Operator status** — the operator sees each run's progress, failures, and model usage per (active region, publication date) without log archaeology.
11. **Client parity** — the reader experience matches deployed bc-newspaper v0.1.x minus contract-forced deviations: region/date navigation and history, unavailable states, code-splitting (the 607 kB chunk follow-up lands here).
12. **Eval harness** — the developer replays the fixture corpus through recorded, local, or hosted adapters for every capability and judge, getting retained comparable results with six truthful usage/cost records for a fully judged run (v1 judge rubrics carried); prompt/model changes are judged on same-input comparisons.

## Order rationale

Skeleton first (done). Config-dispatched ports next because every other capability plugs into that seam. Then generator-lane capabilities (3–6), ingest lane (7–8), and reader/dev lanes (11, 12) can proceed in parallel on disjoint seams; scheduling (9) and status (10) wait on the generator and ingest lanes they orchestrate.

## Related documentation

- [Shape: v2 full rebuild](2026-08-04-v2-full-rebuild.shape.md) — the session this map is grown through.
- [Binding domain model](../DOMAIN.md) — vocabulary authority for every capability id.
- [v1 reference map](../v1-reference.md) — where each carried-forward behavior lives in the predecessor.
