# Evaluation artifacts

This directory contains every named evaluation set created after the fixed
baseline. Create the set directory before its first fixture runs:

`<started-at>-<corpus-version>/`

Every set owns a `README.md`, `evidence/`, and `scorecards/`. The start
timestamp identifies the evaluation set; the corpus version identifies the
fixture contract used for comparison. Its fixture outputs, annotations,
reviews, scorecard inputs, and scorecards stay together in that directory.

The ignored `evaluation-results/`, `scorecard-evidence/`, and
`scorecard-results/` directories are scratch space for ad hoc probes, not named
evaluation sets.

The permanent starting comparison is separate in [`../baseline/`](../baseline/).
