---
type: investigation
title: >-
  Investigation: evaluation benchmark continuation timeout
description: >-
  Runtime measurements identifying why the benchmark-continuation integration test intermittently crosses Vitest's five-second deadline.
tags: [investigation, evaluation, vitest, concurrency, bcn-006]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-10T06:00:58Z"
---
# Investigation Report

**Question:** What is causing `evaluation-benchmark-continuation.test.ts` to
intermittently time out during the broad workspace test run?

**Date:** 2026-08-10

**Scope:**
- **In scope:** The first test in
  `apps/eval/tests/evaluation-benchmark-continuation.test.ts`, its verifier and
  temporary-directory cleanup, Vitest file parallelism, pnpm workspace-package
  concurrency, and controlled isolated/concurrent timing observations.
- **Out of scope (deliberately):** Changing production code, changing a timeout,
  changing test scheduling, optimizing artifact persistence, and the unrelated
  recorded-response stale-lock race. This investigation identifies current
  behavior and cause; it does not implement a remedy.
- **Observation:** The exact test, the full eval suite, a serialized eval suite,
  the generation suite, and the root workspace suite were invoked locally. All
  model-provider traffic stayed on the repository loopback server; no live model
  or external network was used.

---

## Summary

The benchmark-continuation behavior is not failing an assertion. The test is a
substantial integration exercise whose wall time rises from about 1.9 seconds
alone to 3.9 seconds alongside the other parallel eval files, then to 5.164
seconds when the parallel eval suite overlaps the generation/Miniflare suite.
Vitest's default five-second per-test deadline turns that expected scheduling
sensitivity into an intermittent timeout.

After the timeout, Vitest can begin `afterEach` cleanup while the abandoned
asynchronous test body still writes benchmark files. That race caused an
`ENOTEMPTY` cleanup error in one reproduced root run and made two neighboring
tests appear failed; it is a consequence of the timeout, not the initiating
failure.

---

## Root Cause of the Continuation-Test Timeout

The test drives the real serial benchmark command through four configured
scenarios, then reads the retained artifact and performs three mutation-rejection
checks (`apps/eval/tests/evaluation-benchmark-continuation.test.ts:25-52`). The
verifier's four scenarios cover retry success, provider exhaustion, parse
rejection, and a later successful trial
(`apps/eval/src/evaluation-benchmark-verifier.ts:15-40`). The benchmark command
executes every declared roster member in order and persists full Benchmark Run
transitions throughout each trial
(`apps/eval/src/evaluation-benchmark-command.ts:89-127`).

Persistence is deliberately validation-heavy. Every replacement validates the
candidate, parses the current artifact from disk, validates the transition,
writes and parses a temporary artifact, renames it, parses the authoritative
artifact again, and notifies the observer
(`apps/eval/src/evaluation-artifact-store.ts:75-100`). The verifier then strictly
parses every captured incremental snapshot before checking the final artifact
(`apps/eval/src/evaluation-benchmark-verifier.ts:51-56`,
`apps/eval/src/evaluation-benchmark-verifier.ts:97-110`). This explains why the
test consumes meaningful CPU and filesystem time despite using a fake provider.

The controlled timings isolate scheduling as the threshold-crossing factor:

| Invocation | Continuation test | Outcome |
|---|---:|---|
| Exact test only, first focused observation | 1,885 ms | passed |
| Full eval suite with file parallelism disabled and one worker | 1,870 ms | passed |
| Exact test overlapped with generation suite, three runs | 2,251 / 2,258 / 2,243 ms | all passed |
| Full eval suite with normal file parallelism | 3,920 ms | passed |
| Full eval suite overlapped with generation suite | 5,164 ms | timed out |
| Root `pnpm test` reproduction | 5,062 ms | timed out |

The serialized comparison used
`pnpm --filter @bc-news/eval exec vitest run --reporter=verbose
--no-file-parallelism --maxWorkers=1`. The normal eval comparison used the same
command without the final two scheduling flags. The controlled cross-package
comparison ran normal eval and `pnpm --filter @bc-news/generation test`
concurrently. The root reproduction used `pnpm test`; its output directly showed
`apps/eval` and `apps/generation` active together. Vitest's own help reports file
parallelism enabled and a default `testTimeout` of 5,000 ms.

Generation alone is not sufficient to reproduce the failure: overlapping only
the exact continuation test with generation held the test near 2.25 seconds.
The timeout appeared when normal parallelism existed at both levels: other eval
files competed inside the eval run while the generation package's Worker-based
suite ran beside it. The 5,062 ms and 5,164 ms observations leave only 62-164 ms
of excess over the watchdog, which accounts for the intermittent pass/fail
pattern.

The verifier's success message occurs after its benchmark assertions, retained
artifact comparison, and loopback-server close
(`apps/eval/src/evaluation-benchmark-verifier.ts:98-115`). It can therefore print
before the outer test finishes its additional artifact reads and mutation checks
(`apps/eval/tests/evaluation-benchmark-continuation.test.ts:28-52`). Seeing that
message before a timeout proves the inner verifier reached its end; it does not
prove that the complete Vitest test returned before the deadline.

When the deadline fires, the shared helper's `afterEach` immediately removes
every registered temporary root (`apps/eval/tests/evaluation-artifact-test-support.ts:21-32`).
Vitest does not cancel the timed-out promise's underlying filesystem work. In
the reproduced root run, cleanup collided with ongoing writes beneath the
benchmark `results` directory and reported `ENOTEMPTY`, which then attached to
two subsequent tests in the same file. A second controlled timeout reported
only the initiating test failure, confirming that the cleanup symptom is itself
timing-dependent.

---
_Indexed from [project investigations](./index.md) and the
[documentation bundle](../index.md). Testing authority remains in
[TESTING.md](../TESTING.md)._
