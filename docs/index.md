---
okf_version: "0.2"
---

# bc-news documentation

- [Product requirements](PRD.md) — Binding high-level product direction for rebuilding the regional BitCraft newspaper on Cloudflare with durable generation, replaceable models, and evaluation-led development.
- [Structural discipline](ARCHITECTURE.md) — The binding architecture posture for bc-news v2 — TypeScript throughout, exactly two ports (model provider, evidence input), functional core with zod-validated rejecting boundaries, and deliberate Cloudflare coupling everywhere else.
- [Domain model](DOMAIN.md) — The binding domain vocabulary and identity rules for bc-news v2 — what an edition is, what identifies a generation run, and which domain questions remain deliberately open for planning.
- [Test and verification posture](TESTING.md) — The binding evidence discipline for bc-news v2 — what proves a change works, in which tier, what isolated tests defend and never defend, and how the eval harness fits as the editorial-quality tier.
- [v1 reference map](v1-reference.md) — Descriptive map of the frozen predecessor repos — which copies to read, where the proven ingest, prompt, schema, and client material lives, and what made v1's orchestration fragile.
