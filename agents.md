# Root System Context

## Purpose
Ikamva Virtual Admin Assist is a multi-tenant B2B platform for automating virtual assistant operations through secure integrations, an asynchronous task ledger, and AI-assisted execution flows.

## Ownership
This root document owns project-wide engineering contracts, shared architecture rules, and the top-level Child DOX Index. Domain-specific rules live in the nearest child `agents.md`.

## Local Contracts
- All durable work must preserve tenant isolation through a validated `client_id`.
- OAuth credentials and other secrets must never be logged or stored in plain text.
- `vercel.json` is the core deployment routing configuration for Vercel serverless functions, frontend fallback routing, and cron scheduling.
- Durable domain folders must keep their own `agents.md` current when responsibilities, contracts, schemas, workflows, or verification rules change.
- Avoid duplicate utility modules or detached helper scripts; shared behavior should be owned by the appropriate domain.

## Work Guidance
- Read this file and the nearest applicable child `agents.md` before editing files in a domain.
- After meaningful changes, perform a DOX pass and update affected `agents.md` files and Child DOX Index entries.

## Verification

## Child DOX Index
- `database/agents.md`: Owns multi-tenant database schema, Row-Level Security rules, and encrypted integration credential storage.
- `queue/agents.md`: Owns persistent task polling, sequential processing, tenant-aware throttling, and queue failure handling.
- `ai/agents.md`: Owns ephemeral per-task AI context construction, Worker/Supervisor orchestration, and validation feedback loops.
- `integrations/agents.md`: Owns OAuth tokenization, third-party API gateways, manual approval enforcement, and production delivery logging.
- `frontend/agents.md`: Owns client and admin dashboard surfaces that connect users to OAuth, task upload, review, and approval workflows.
- `api/agents.md`: Owns Vercel serverless HTTP endpoints that expose backend queue, approval, and delivery workflows.
