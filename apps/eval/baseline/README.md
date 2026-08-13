# Evaluation baseline

This directory is the permanent starting baseline for model comparison. It is
the ten-model, twelve-fixture evaluation completed on 2026-08-13. Each model
ran every fixture once through all four production steps.

The baseline is fixed. Later evaluations do not replace, update, or redefine
it; they are retained separately under [`../artifacts/`](../artifacts/).

## Baseline roster

| Execution | Model | Evidence | Scorecard |
|---|---|---|---|
| Local | `prism-ml/bonsai-27b` | [evidence](evidence/local-bonsai-27b/scorecard-input.json) | [scorecard](scorecards/bonsai-27b.json) |
| Local | `google/gemma-4-e4b` | [evidence](evidence/local-gemma-4b/scorecard-input.json) | [scorecard](scorecards/gemma-4b.json) |
| Local | `google/gemma-4-12b` | [evidence](evidence/local-gemma-12b/scorecard-input.json) | [scorecard](scorecards/gemma-12b.json) |
| Local | `google/gemma-4-12b-qat` | [evidence](evidence/local-gemma-12b-qat/scorecard-input.json) | [scorecard](scorecards/gemma-12b-qat.json) |
| Hosted | `@cf/google/gemma-4-26b-a4b-it` | [evidence](evidence/hosted-gemma-4-26b/scorecard-input.json) | [scorecard](scorecards/gemma-4-26b.json) |
| Hosted | `openai/gpt-5-nano` | [evidence](evidence/hosted-gpt-5-nano/scorecard-input.json) | [scorecard](scorecards/gpt-5-nano.json) |
| Hosted | `openai/gpt-4o-mini` | [evidence](evidence/hosted-gpt-4o-mini/scorecard-input.json) | [scorecard](scorecards/gpt-4o-mini.json) |
| Hosted | `google/gemini-3.1-flash-lite` | [evidence](evidence/hosted-gemini-3-1-flash-lite/scorecard-input.json) | [scorecard](scorecards/gemini-3-1-flash-lite.json) |
| Hosted | `google/gemini-2.5-flash-lite` | [evidence](evidence/hosted-gemini-2-5-flash-lite/scorecard-input.json) | [scorecard](scorecards/gemini-2-5-flash-lite.json) |
| Hosted | `minimax/m3` | [evidence](evidence/hosted-minimax-m3/scorecard-input.json) | [scorecard](scorecards/minimax-m3.json) |

## Contents

- `evidence/<model>/` contains the twelve Benchmark Runs, annotations,
  qualitative reviews, and scorecard input for one model.
- `scorecards/<model>.json` contains the derived scorecard for that model.
- [`MODELS.md`](../../../MODELS.md) contains the pricing used for cost
  comparisons.

Benchmark Runs, annotations, reviews, and scorecards retain their original
contents. The scorecard-input path fields identify their permanent baseline
locations. Each scorecard's embedded source reference continues to identify
the original commit and path from which that scorecard was generated.
