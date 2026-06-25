# API Domain

## Purpose
Owns Vercel serverless HTTP endpoints that expose backend domain logic to cron jobs, dashboards, and authenticated clients.

## Ownership
This document governs files in `api/`, including request parsing, HTTP method guards, serverless handler exports, and endpoint-level validation before calling backend modules.

## Local Contracts
- All backend logic must be exposed as serverless HTTP endpoints exporting a default async request handler.
- API handlers must preserve tenant boundaries by requiring a verified `client_id` before calling tenant-scoped database or integration logic.
- API handlers must not contain durable business logic that belongs to `database/`, `queue/`, `ai/`, or `integrations/`; they should validate HTTP input and delegate to domain modules.

## Work Guidance
- Use explicit HTTP method checks and return JSON responses.
- Keep Vercel Cron handlers short and idempotent; one request should trigger one bounded worker cycle.
- Approval endpoints must change a reviewed task to `approved` before calling production delivery, preserving the manual approval gate.

## Verification
- Review each endpoint to confirm it exports an async handler, validates method and payload, and delegates to existing backend modules.

## Child DOX Index
