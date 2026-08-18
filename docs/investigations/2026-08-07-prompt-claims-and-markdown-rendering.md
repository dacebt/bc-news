---
type: investigation
title: >-
  Investigation: Prompt claims and markdown rendering at the 2026-08-07 snapshot
description: >-
  Point-in-time verification of the prompt-contract review claims and the client path that parsed, filtered, and presented model-authored markdown.
tags: [investigation, prompts, markdown, client, rendering]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-18T14:53:45Z"
---
# Investigation Report

**Question:** "yeah let's verify claims and we need to make markdown rendering stronger actually. I have ideas to improve the frontend using better tech."

**Date:** 2026-08-07

**Snapshot:** Repository state at `6062d12` for the observed renderer and prompt
behavior. Unqualified code paths and line references below describe that
point-in-time source tree.

**Scope:**
- **In scope:** The four current runtime prompt contracts, their schemas and retained benchmark evidence, the client components that render edition prose, markdown filtering and normalization, current markdown dependencies, client tests, and the code surfaces coupled to a rendering-technology change.
- **Out of scope (deliberately):** Prompt edits, frontend changes, dependency selection, a new content contract, live model calls, and external technology research. The requested unit is verification and current-state understanding before the user's frontend ideas are evaluated.
- **Observation:** `pnpm --filter @bc-news/client test` executed the current client and passed 48 tests across seven files. A narrower server-render exercise invoked `MainStoryBody` and `MarkdownText` with emphasis, single-newline prose, headings, lists, blockquotes, links, raw HTML, markdown images, and a `javascript:` URL. The composed edition application was not started because this investigation did not create or replace local API/D1 edition state.

---

## Summary

The prompt-contract claims are confirmed with two qualifications: the alleged main-story fabrications are more precisely unsupported or distorted synthesis, and the copyeditor no-op observation applies to the one retained four-model benchmark rather than all possible runs. The client currently accepts a substantially broader CommonMark surface than the prompts authorize, gives main-story bodies and announcement summaries different newline semantics, and has no newspaper-specific element renderers. Its active-content posture held in direct rendering, but its presentation contract is permissive, thinly styled, and coupled to a manually enumerated markdown dependency chunk.

**Follow-up (verified 2026-08-18):** `ec7025f` replaced the two renderer paths
with one sanitized, allowlisted `NewspaperText` boundary, and `9642aa3`
resolved the writer's contradictory markdown instructions. The optional-image
mismatch identified below remains. The benchmark artifact cited below and the
old `MainStoryBody.tsx` and `MarkdownText.tsx` paths are unavailable in the
current checkout; the renderer and benchmark sections preserve point-in-time
evidence rather than current implementation guidance.

---

## Prompt Claims and Current Markdown Rendering

### Prompt-contract verification

The writer system message contains a literal conflict: `[OUTPUT]` says "No markdown," while `[FORMATTING]` requires bold player names and italic game terms or emphasis (`packages/generation-core/src/main-story.ts:11-33`). This is not an interpretive concern; both instructions are delivered in the same system message to both writer steps (`apps/generation/src/generation-run.ts:140-146`, `apps/generation/src/generation-run.ts:185-191`).

The optional-image mismatch is also confirmed. `MainStorySchema` permits `image`, including URL, caption, and optional credit (`packages/contracts/src/edition.ts:12-21`), while the main-story writer's displayed output contract names only headline, lede, and body (`packages/generation-core/src/main-story.ts:104-114`). The copyeditor parser nevertheless protects image shape and URL (`packages/generation-core/src/main-story.ts:157-213`). The client `MainStory` component reads only headline, lede, and body, so an accepted image value is not rendered (`apps/client/src/components/MainStory.tsx:8-62`).

Provider behavior differs as previously reported. LM Studio receives a production-step-specific strict JSON schema (`packages/model-adapters/src/openai-compatible-model-provider.ts:143-167`), while the hosted branch sends only the model and two messages (`packages/model-adapters/src/openai-compatible-model-provider.ts:267-285`). Both branches still pass completion text through the same runtime parsers before it becomes a typed editorial product (`apps/generation/src/generation-run.ts:140-219`).

The deterministic final-product checks do not enforce the full prose contract. They reject a short marker list, ungrounded bold spans, and ungrounded quoted spans, but do not classify announcement semantics, check all factual prose, or require bold spans to be player names (`apps/eval/src/product-checks.ts:7-79`). That explains how the retained Qwen announcement product could bold numeric quantities without a deterministic finding: the check only establishes that the marked text appears somewhere in the prepared evidence.

Direct queries over `apps/eval/evaluation-results/benchmark-2026-08-06T23-18-31-331Z-6e69561f-f587-440c-a728-1adcad5be0ab.json` confirmed the retained-behavior claims. The four final announcement counts were 6, 4, 6, and 10 for Qwen, GPT-OSS, Bonsai, and Gemma respectively. All four announcement copyedit outputs equalled their writer outputs after internal IDs were removed. Main-story copyedit changed Qwen and GPT-OSS output but not Bonsai or Gemma; inspection shows Qwen's change removed trailing spaces and GPT-OSS changed "absentia" to "absence" while leaving a forbidden em dash that caused final-product rejection. This is evidence about one repetition under the benchmark's declared configuration, not a universal statement about copyeditor value.

The Qwen main story's questionable statements are confirmed as unsupported or distorted synthesis against the retained prepared evidence. It converted "Tier eleventy?" followed by "t5" into an availability query for Tier 11 ore; described a bare "100k t1 smithing at sanctuary" report as a seller offer; claimed a Peerless Leather request drew a seller response even though the evidence contains only that one Peerless Leather message; connected an inventory response of "full set / tools / +1 leg" to preparation for an assault; and moved a 03:23 task-reset notice into its closing nighttime scene. These are semantic-grounding failures that strict JSON parsing and the current deterministic checks do not claim to detect.

The current ignored local `MODEL_CONFIG` is a different observation surface from that retained benchmark. A read-only parse of `apps/generation/.dev.vars` on 2026-08-07 showed Qwen assigned to all four steps with `temperature: 0`, `top_p: 1`, `top_k: 1`, and no reasoning. The retained four-model benchmark declares `temperature: 1`, `top_p: 0.95`, and `top_k: 20`. Its outputs are diagnostic history, not a same-configuration baseline for a future prompt edit.

### Current client rendering path

Only `main_story.body` and announcement `summary` pass through markdown. Masthead title, subtitle/dateline context, main-story headline, lede, and announcement titles render as ordinary React text (`apps/client/src/components/MainStory.tsx:8-62`, `apps/client/src/components/Announcements.tsx:5-43`, `apps/client/src/pages/EditionPage.tsx:17-37`). Both markdown surfaces use `react-markdown` without remark or rehype plugins and without custom element components (`apps/client/src/components/MainStoryBody.tsx:13-18`, `apps/client/src/components/MarkdownText.tsx:5-12`).

The accepted rendering surface is broader than the authored contract. The prompts authorize bold player names and italic game terms or emphasis and prohibit markdown headers, code blocks, and inline code (`packages/generation-core/src/main-story.ts:22-33`), but the client only disallows `script`, `iframe`, `object`, `embed`, and `img` (`apps/client/src/components/markdown-security.ts:1-5`). The direct render exercise observed `<h1>`, `<ul>`, `<blockquote>`, and a normal external `<a>` from model text. Those elements are therefore live rendering behavior even though the writer contract does not authorize them.

Main stories and announcements interpret the same source text differently. `MainStoryBody` trims every nonblank source line and rejoins each as a separate markdown paragraph (`apps/client/src/components/MainStoryBody.tsx:5-11`); `MarkdownText` passes the original text directly to the parser (`apps/client/src/components/MarkdownText.tsx:5-10`). The direct render exercise confirmed that `First line\ncontinues same thought` became two `<p>` elements in a main story but remained one paragraph in an announcement. It also caused list items in a main story to contain paragraph elements, unlike the same list rendered through `MarkdownText`.

The active-content claims held in the direct render exercise. Raw `<script>` text rendered escaped rather than becoming an element, a markdown image produced no `<img>`, and a `javascript:` link rendered with an empty `href`. This observation confirms the current behavior of the installed dependency and props; it does not establish a general sanitizer contract for future plugins or renderer replacements.

Presentation is largely inherited from browser/Chakra defaults. `MainStory` explicitly styles only top-level paragraphs and the first paragraph's drop cap (`apps/client/src/components/MainStory.tsx:31-59`); neither markdown wrapper supplies custom renderers for headings, lists, blockquotes, links, strong text, or emphasis. The client test suite contains no dedicated imports or assertions for `MainStoryBody`, `MarkdownText`, or `markdown-security.ts`; the 48 passing tests cover the surrounding client behavior but not these markdown semantics.

### Impact Scan

The current coupling separates into three distinct change surfaces:

- A renderer-only change is bounded primarily by `MarkdownText.tsx`, `MainStoryBody.tsx`, `markdown-security.ts`, the client dependency declaration, and the manually maintained markdown chunk in `vite.config.ts` (`apps/client/vite.config.ts:4-81`, `apps/client/vite.config.ts:94-115`).
- A change to which markdown constructs models may author also reaches the shared writer/copyeditor instructions, copyedit preservation patterns, deterministic final-product checks, prompt-bound recorded responses, and the client presentation rules (`packages/generation-core/src/main-story.ts:11-51`, `packages/generation-core/src/copyedit-preservation.ts:133-175`, `apps/eval/src/product-checks.ts:7-79`).
- Replacing markdown strings with structured rich content reaches the edition schema and every model-facing/runtime schema derived from it, in addition to prompt builders, parsers, persistence/API validation, and client components (`packages/contracts/src/edition.ts:5-21`, `packages/model-adapters/src/lmstudio-structured-output.ts:67-80`, `apps/client/src/api/edition.ts:113-119`).

These are current dependency boundaries only. Selecting among them requires the intended authoring and reader experience, which this investigation deliberately does not infer.

---
_Indexed from [project investigations](./index.md) and the [documentation bundle](../index.md)._
