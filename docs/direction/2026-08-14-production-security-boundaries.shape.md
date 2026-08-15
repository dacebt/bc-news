---
type: shape
title: >-
  Shape: BCN-008 production security boundaries
description: >-
  Session boundaries, loose cadence, and local success signal for hardening the production HTTP, data, and deployment seams.
tags: [wsd, direction, shape, security, cloudflare, deployment]
status: stable
generated:
  by: ebt-wsd/okf-v0.2
  at: "2026-08-14T13:07:09Z"
---
# Shape: BCN-008 production security boundaries

**Declared:** 2026-08-14
**Cadence:** Loose
**Git strategy:** worktree-isolated at `.worktrees/bcn-008-production-security` on branch `bcn-008-production-security`; no merge, push, deployment, or remote Cloudflare mutation

## In scope

- Make the newspaper, built assets, and pair-addressed published-edition read API the only intentionally public application surfaces.
- Protect generation launch and pair-addressed operator status with one Worker-held bearer-secret boundary, remove the raw Workflow-ID status surface, and bound launch input before side effects.
- Add deliberate cache, rate, response-header, and browser-header behavior compatible with the real React/Chakra client.
- Explicitly disable alternate generation and ingest Worker origins, preserve binding-only parameterized D1 access, and declare the repository-side production secret contract without storing credentials.
- Resolve or explicitly evidence the current dependency advisories, add focused boundary coverage, and keep the composed Worker/D1/API/browser walk green.

## Out of scope (deliberately)

- Cloudflare account changes, secret installation, Access or WAF configuration, deployment, production database inspection, or remote hostname exercises without separate exact authorization.
- Model-provider selection, prompt or evaluation changes, hosted inference, or changes owned by BCN-002.
- Custom-domain provisioning owned by BCN-007, except that checked-in Worker exposure must not create an alternate public origin.
- Changing the shared D1 schema or ownership unless the security walk reveals a concrete defect.

## Known risks

- The bearer boundary must fail closed without breaking Cron, Workflow, or the canonical local operator walk.
- A useful CSP must accommodate Chakra/Emotion runtime styles and generated data-URI textures without permitting unrelated script or frame execution.
- Rate limiting and cache behavior must be locally observable while remaining valid for the installed Wrangler and Cloudflare Workers plan.

## Success signal

In the isolated composed walk, public newspaper and edition reads still succeed with the intended headers and quota posture, unauthenticated generation launch and status requests fail without starting or exposing work, authenticated pair-addressed operator use succeeds, the raw Workflow-ID route is absent, alternate Worker origins are explicitly disabled, focused and repository gates pass, and the walk ends in `WALK PASS`.

## Related documentation

- [Production security capability map](2026-08-14-production-security-boundaries.map.md) — risk-ordered feature carve and the frozen HTTP boundary conventions.
- [Binding architecture](../ARCHITECTURE.md) — Cloudflare topology, port discipline, and composed-walk authority.
- [Binding testing posture](../TESTING.md) — acceptance and verification-domain authority.
