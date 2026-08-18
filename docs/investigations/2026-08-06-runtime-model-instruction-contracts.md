---
type: investigation
title: "Investigation: Runtime model instruction contracts at the 2026-08-06 snapshot"
description: >-
  Evidence-backed snapshot of how bc-news assembled, constrained, validated, and executed the four runtime model instructions at the time of investigation.
tags: [investigation, prompts, generation, model-contracts]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:53:45Z"
---
# Investigation Report

**Question:** "I know we still need to apply prompt-craft to the instructions and I need to take a look at those instructions myself. research and create a task for that."

**Date:** 2026-08-06

**Snapshot:** Repository state at `16a3087`. Unqualified code paths and line
references below describe that point-in-time source tree.

**Scope:**

- **In scope:** The four production model steps; their system and user prompt builders; untrusted-data boundaries; model-facing JSON schemas; provider request construction; output parsing; copyedit preservation; retry classification; prompt-carriage tests; the binding product, architecture, and verification contracts; and the v1 prompt source named by the repository as product knowledge.
- **Out of scope (deliberately):** Editing or tuning prompts, selecting models, rerunning the abandoned multi-model benchmark, changing eval architecture, changing acceptance policy, or changing the skeleton walk. Those are future work, not research.
- **Observation:** Static trace only. A live model call was not made because the requested unit excludes benchmark execution and the current runner cannot retain a rejected attempt for diagnosis. The code paths were traced from both production and the local runner, but no claim about model quality is made. See the binding [structural discipline](../ARCHITECTURE.md) and [test and verification posture](../TESTING.md).

---

## Summary

The runtime instruction contract is not one prompt file. It is a distributed contract spanning shared system messages, four user-message builders, untrusted-data serialization, model-facing decoding schemas, runtime parsers, copyedit preservation checks, provider-specific request mechanics, and Workflow retry classification. Production and local tooling do reuse the same builders and parsers, but the complete contract differs by provider: LM Studio receives a strict JSON schema while the hosted adapter receives only system and user messages. A useful human review therefore has to present the assembled contract per production step, not only the prose constants.

**Follow-up (verified 2026-08-18):** `9642aa3` corrected the prompt-contract
conflict, `40dbbdd` later revised the daily editorial prompts, `e78899b`
selected LM Studio's answer-only response channel, and `c80785b` added hosted
structured-output schemas. The optional-image mismatch identified below remains:
the contract permits `main_story.image`, while the writer field contract omits
it and the client does not render it. The original trace remains historical
evidence rather than a description of the current provider paths.

---

## How the Four Runtime Instruction Contracts Work

The product owns two editorial products and exactly four ordered production model steps. Writers receive prepared evidence; copyeditors receive only their own typed draft; code assembles the edition without a packaging or judge call (`docs/PRD.md:47-60`, `docs/ARCHITECTURE.md:150-162`).

### Message ownership and assembly

`main_story_write` and `announcements_write` share `WRITER_SYSTEM_CONSTRAINTS`, which defines JSON-only output, chat-message distrust, editorial voice, and formatting (`packages/generation-core/src/main-story.ts:11-33`). Their user messages supply distinct assignments, reporting rules, fenced prepared evidence, and output shapes (`packages/generation-core/src/main-story.ts:84-115`, `packages/generation-core/src/announcements.ts:32-59`).

`main_story_copyedit` and `announcements_copyedit` share `COPYEDIT_SYSTEM_CONSTRAINTS`, which narrows the role and permitted changes and requires shape-preserving JSON (`packages/generation-core/src/main-story.ts:35-51`). Their user messages supply only the filed product: the main-story draft or the announcement draft with stable internal ids (`packages/generation-core/src/main-story.ts:147-155`, `packages/generation-core/src/announcements.ts:84-100`).

Both production and local tooling assemble the same two-message request shape. The Workflow calls the four builders and parsers in order (`apps/generation/src/generation-run.ts:140-219`); the local runner mirrors that order and records the exact request and completion at each call (`apps/eval/src/production-step-runners.ts:49-140`). The model-provider port itself carries exactly `productionStep`, `system`, and `user` (`packages/generation-core/src/ports.ts:39-43`).

### Instructions and untrusted data

Prepared chat is serialized inside explicit untrusted-data fences. Newlines are flattened so one chat message cannot forge another transcript record, and opening brackets in message data are neutralized so content cannot reproduce a structural section marker (`packages/generation-core/src/untrusted-data-fence.ts:9-75`). Writer output remains untrusted when passed to a copyeditor; JSON string values escape opening brackets while object structure remains intact (`packages/generation-core/src/untrusted-data-fence.ts:78-94`). Tests establish that forged section text is neutralized and copyedit prompts omit source evidence and the other editorial product (`packages/generation-core/tests/main-story.test.ts:40-60`, `packages/generation-core/tests/announcements.test.ts:43-54`, `packages/fixtures/tests/prompt-carriage.test.ts:25-46`).

### Output contracts and enforcement

The prose output sections describe field purpose using JSON-shaped examples, while the runtime Zod schemas impose structural constraints. Main-story fields are nonempty strings and may also contain an optional image object, even though the writer's displayed output shape does not mention `image` (`packages/contracts/src/edition.ts:12-21`, `packages/generation-core/src/main-story.ts:104-114`). Announcement items are nonempty `title` and `summary` strings (`packages/contracts/src/edition.ts:5-8`, `packages/generation-core/src/announcements.ts:49-58`). Invalid JSON and schema mismatch become step-specific `EditorialOutputContractError`s (`packages/generation-core/src/main-story.ts:117-145`, `packages/generation-core/src/announcements.ts:61-81`).

LM Studio receives a strict inline JSON schema chosen by production step and generated from the Zod schemas (`packages/model-adapters/src/lmstudio-structured-output.ts:51-80`, `packages/model-adapters/src/openai-compatible-model-provider.ts:143-167`). One provider adaptation is explicit: the LM Studio announcement-copyedit grammar relaxes the internal id regex to a plain string, while the application parser still requires the exact id shape and the preservation check still requires identity and order (`packages/model-adapters/src/lmstudio-structured-output.ts:13-15`, `packages/generation-core/src/announcements.ts:103-158`). The hosted OpenAI-compatible request sends only model plus system/user messages and does not send the LM Studio decoding controls or JSON schema (`packages/model-adapters/src/openai-compatible-model-provider.ts:267-285`; also documented at `docs/ARCHITECTURE.md:164-173`).

Copyedit acceptance extends beyond shape parsing. Code independently compares paragraph counts, ordered quoted spans, numeric literals, and protected markdown (`packages/generation-core/src/copyedit-preservation.ts:133-175`); the main-story parser also protects optional image shape and URL (`packages/generation-core/src/main-story.ts:157-213`); announcement parsing protects count, ids, and order (`packages/generation-core/src/announcements.ts:126-158`). These checks are mechanical invariants, not proof of semantic equivalence (`docs/TESTING.md:123-129`).

### Failure and retry semantics

The production Workflow gives model steps a three-attempt ceiling for retryable failure (`apps/generation/src/generation-run.ts:38-45`). Output-contract and copyedit-preservation errors are wrapped as nonretryable because the application classifies them as deterministic (`apps/generation/src/non-retryable.ts:14-49`). By contrast, network, timeout, body-read, and selected HTTP failures remain retryable at the provider boundary (`packages/model-adapters/src/openai-compatible-model-provider.ts:208-228`, `packages/model-adapters/src/openai-compatible-model-provider.ts:286-320`).

The local `run` path executes all four production steps and final deterministic product checks before constructing and saving a run file (`apps/eval/src/run-command.ts:19-58`). Therefore a parse or preservation rejection ends the command before retained run evidence exists. That is the separate architectural problem already captured by the real-model-evaluation task; it also means this investigation has no raw Qwen copyedit completion to inspect.

### Product lineage

The repository explicitly identifies the v1 editorial voice as product knowledge worth carrying near-verbatim and warns that v1 production and eval prompts were independently maintained copies (`docs/v1-reference.md:41-50`, `docs/v1-reference.md:63-67`). The current writer constraints preserve several v1 voice rules, but the current main-story assignment is materially shorter than the v1 source: v1 included explicit mood, transition, paragraph-rhythm, quote examples, and detail guidance (`../bc-news-worker/apps/generator/src/llm/prompts.ts:92-157`). Whether each omitted instruction is still desired product behavior is not settled by the current code trace.

---

## Layer Map

| Responsibility | Current owner | What it contributes |
|---|---|---|
| Product/editorial intent | `docs/PRD.md`, `docs/v1-reference.md`, ADR-015 | Two writer-to-copyedit tracks, inherited voice, role boundaries |
| System instructions | `packages/generation-core/src/main-story.ts` | Shared writer and copyeditor authority, output, security, voice, formatting |
| Step assignments | `main-story.ts`, `announcements.ts` | Per-product task, reporting rules, draft handling, displayed output shape |
| Data isolation | `untrusted-data-fence.ts` | Transcript and draft fencing/neutralization |
| Decode constraint | `lmstudio-structured-output.ts` | LM Studio-only strict JSON grammar selected by step |
| Boundary validation | step parsers plus Zod contracts | JSON parsing and structural rejection |
| Domain acceptance | `copyedit-preservation.ts`, `product-checks.ts` | Mechanical preservation and deterministic final-product checks |
| Provider mechanics | `openai-compatible-model-provider.ts`, adapter config | Roles, model, sampling, reasoning, schema use, transport behavior |
| Retry classification | Workflow plus `non-retryable.ts` | Transport retry versus deterministic hard failure |
| Retained request binding | fixtures and runner | Hash of the exact `{system, user}` request and model provenance |

---

## Absences Relevant to Review

- There is no single generated reviewer artifact that displays, per production step, the exact system message, user-message template, representative rendered request with data visibly separated, decoding schema, runtime schema, downstream checks, provider differences, and retry classification. Those facts currently require a cross-file trace.
- The prompt prose, model-facing schema, runtime parser, and preservation rules do not share one semantic description source. They are connected by call sites and tests, but human-readable field meaning and code-enforced invariants live in different artifacts.
- The main-story model-facing/runtime schema permits an optional image that the writer output section does not describe (`packages/contracts/src/edition.ts:12-21`, `packages/generation-core/src/main-story.ts:104-114`).
- Hosted inference has strict response-envelope validation and runtime output parsing, but no provider-side structured-output constraint in the current request body (`packages/model-adapters/src/openai-compatible-model-provider.ts:267-285`, `packages/model-adapters/src/openai-compatible-model-provider.ts:322-363`).
- Existing prompt tests prove carriage, isolation, and deterministic parser behavior. They do not evaluate whether the instruction semantics produce the intended newspaper behavior; the binding verification document explicitly requires representative live-model evaluation for that claim (`docs/TESTING.md:123-129`).

---
_Indexed from [project investigations](./index.md) and the [documentation bundle](../index.md)._
