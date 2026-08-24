---
type: doc
title: >-
  Generation Worker deployment operations
description: >-
  Manual Cloudflare dashboard setup for the Git-connected generation Worker, bundled client, runtime bindings, variables, secrets, and first deployment checks.
tags: [documentation, deployment, cloudflare, generation, operations]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-23T23:13:23Z"
authority: descriptive
---

# Generation Worker deployment operations

The deployed application is one `bc-news-generation` Worker. Its Vite-built
client is uploaded as Workers Static Assets beside the generation script; no
Cloudflare Pages project exists. The already-deployed ingest Worker remains a
separate scheduled service and is not part of this setup.

This is a dashboard-operated deployment. The commands below are values entered
into Cloudflare Workers Builds; they are not local deployment instructions.
Cloudflare's current [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
distinguishes build-only values from runtime variables and secrets.

## Before connecting the repository

1. In **Workers & Pages**, create or select a Worker named exactly
   `bc-news-generation`. The dashboard name must match the checked-in Wrangler
   `name`.
2. Under **Settings > Variables and Secrets**, add these runtime values before
   the first Git deployment because Wrangler validates required secrets during
   deploy:

   | Name | Type | Value |
   |---|---|---|
   | `CF_ACCOUNT_ID` | Text | The Cloudflare account ID that owns the Worker, shared D1 database, AI Gateway, and billing account. |
   | `CF_AI_GATEWAY_API_TOKEN` | Secret | A dedicated token scoped to this account with **Account > Workers AI > Read**. |
   | `OPERATOR_API_TOKEN` | Secret | A dedicated random bearer token used only for authenticated generation launch and status requests. |

   These are runtime values, not **Settings > Build > Build Variables and
   Secrets**. Cloudflare documents dashboard secret installation under
   [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
3. In **AI > AI Gateway**, confirm the account has a gateway named `default`
   and enough Unified Billing credits for third-party inference. The Worker
   sends `cf-aig-gateway-id: default`; Cloudflare can create this gateway on the
   first authenticated request, but creating and checking it in the dashboard
   makes the billing and logging posture explicit. No Google API key is needed.
4. Confirm the existing `bc-news-editions` D1 database is the same database
   used by ingest. Do not create a second database for generation. Generation
   remains the migration owner.

The runtime `CF_AI_GATEWAY_API_TOKEN` is not the Workers Builds deployment token.
Workers Builds reserves `CLOUDFLARE_API_TOKEN` for deployment authentication;
the running Worker reads only `CF_AI_GATEWAY_API_TOKEN` for AI Gateway inference.

## Workers Builds settings

Connect the repository to the existing `bc-news-generation` Worker and use:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | Repository root; leave blank |
| Build command | `pnpm --filter @bc-news/client build` |
| Deploy command | `pnpm --filter @bc-news/generation exec wrangler deploy` |
| Non-production branch builds | Disabled |
| Build cache | Enabled |

Under **Settings > Build > Build Variables and Secrets**, set the non-secret
build variable `PNPM_VERSION` to `10.28.2`, matching the version used to verify
this checkout. Cloudflare automatically installs workspace dependencies before
the build command. The build produces `apps/client/dist`; the deploy command
then reads `apps/generation/wrangler.jsonc` and uploads those files with the
Worker.

The checked-in configuration owns `EVIDENCE_INPUT`, `MODEL_CONFIG`, the D1 and
Workflow bindings, the rate limiter, the daily cron, and the static-assets
directory. Do not duplicate or override `EVIDENCE_INPUT` or `MODEL_CONFIG` in
the dashboard. `keep_vars` exists only to preserve the dashboard-owned
`CF_ACCOUNT_ID`; Wrangler deployments preserve encrypted secrets
independently.

## First deployment checks

After the first successful Workers Build:

1. Confirm the Worker shows the `DB`, `GENERATION_RUN`, and
   `EDITION_API_RATE_LIMITER` bindings, the `0 0 * * *` trigger, and uploaded
   static assets.
2. Add the intended custom domain to `bc-news-generation`. The checked-in
   configuration disables `workers.dev` and preview URLs, so the custom domain
   is the reader origin for both the newspaper and `/api/edition`.
3. Confirm `/` serves the client and an unknown path returns the Worker's JSON
   404 rather than an SPA fallback.
4. Confirm an unauthenticated `/generation-run` request is rejected. Keep the
   `OPERATOR_API_TOKEN` outside URLs, logs, source, and browser storage when
   making an authenticated manual launch or status request.
5. After the first authenticated generation run, confirm the pair-addressed
   status reaches both writer steps, the published edition is readable through
   `/api/edition`, and AI Gateway logs identify
   `google/gemini-3.1-flash-lite` for both production steps.

These checks are production observations. Local tests, a Workers Build, and a
dry-run bundle cannot prove the remote D1 migration state, secret values,
billing credits, custom-domain routing, scheduled execution, or live model
availability.

## Links

- Implements the serving and configuration boundaries in [structural discipline](ARCHITECTURE.md).
- Uses the verification-domain separation in [test and verification posture](TESTING.md).
- Uses the selected model and billing route recorded in [model admission and pricing](model-pricing.md).
- Preserves the product deployment boundary in [product requirements](PRD.md).
