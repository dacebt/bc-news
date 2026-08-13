# Current evaluation baseline

The current model-selection baseline is the ten-model, twelve-fixture corpus
completed on 2026-08-13. Each model ran every fixture once through all four
production steps. This file is the pointer to the current baseline; timestamps,
directory modification times, and scorecard UUIDs do not determine which run is
current.

## Baseline roster

| Execution | Model | Commit-addressed evidence | Scorecard |
|---|---|---|---|
| Local | `prism-ml/bonsai-27b` | [evidence](scorecard-evidence/rerun-bonsai-27b-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-55-56-712Z-f5c60902-e072-4abc-84e4-e0cd2541495c.json) |
| Local | `google/gemma-4-e4b` | [evidence](scorecard-evidence/rerun-gemma-4b-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-16-485Z-b9358cdb-0ce5-48d1-be38-07c142e72e64.json) |
| Local | `google/gemma-4-12b` | [evidence](scorecard-evidence/rerun-gemma-12b-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-19-648Z-e90f3b96-f3a8-4291-a886-420305f75f4e.json) |
| Local | `google/gemma-4-12b-qat` | [evidence](scorecard-evidence/rerun-gemma-12b-qat-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-22-704Z-d09e2ed4-aa00-464b-a406-be07522b8273.json) |
| Hosted | `@cf/google/gemma-4-26b-a4b-it` | [evidence](scorecard-evidence/rerun-cloudflare-gemma-4-26b-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-25-798Z-68a81076-32ba-4d90-9995-72b9d5e942b8.json) |
| Hosted | `openai/gpt-5-nano` | [evidence](scorecard-evidence/rerun-cloudflare-gpt-5-nano-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-28-998Z-b38c4b5e-2f85-44ec-9197-2a6855572d65.json) |
| Hosted | `openai/gpt-4o-mini` | [evidence](scorecard-evidence/rerun-cloudflare-gpt-4o-mini-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-32-217Z-c050a924-64c6-453c-b45f-edd124c9030f.json) |
| Hosted | `google/gemini-3.1-flash-lite` | [evidence](scorecard-evidence/rerun-cloudflare-gemini-3-1-flash-lite-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-35-405Z-48b420d9-e582-4c50-8e7a-c5f8fbb7bf4e.json) |
| Hosted | `google/gemini-2.5-flash-lite` | [evidence](scorecard-evidence/rerun-cloudflare-gemini-2-5-flash-lite-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-38-540Z-ae622a8d-d4a6-4a31-be65-467bff664361.json) |
| Hosted | `minimax/m3` | [evidence](scorecard-evidence/rerun-cloudflare-minimax-m3-20260813/scorecard-input.json) | [scorecard](scorecard-results/scorecard-2026-08-13T18-56-41-758Z-493e5603-7d8b-4e63-b183-43e1f05f8bdc.json) |

## Directory roles

- `evaluation-results/` contains ignored working output from benchmark and
  diagnostic runs. It is not the durable baseline index.
- `scorecard-evidence/` contains committed, model-specific evidence bundles.
  Each baseline bundle contains twelve Benchmark Runs, `annotations.json`,
  `reviews.json`, and `scorecard-input.json`.
- `scorecard-results/` contains the derived, committed scorecards. Their UUID
  filenames are immutable identities, not a recency signal.
- [`MODELS.md`](../../MODELS.md) contains the model pricing used for cost
  comparisons.

Historical and excluded-model evidence remains available for provenance but is
not part of this baseline. A future baseline replaces the roster in this file
without deleting or renaming the evidence referenced by an earlier revision.
