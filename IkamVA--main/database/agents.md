# Database & Auth Domain

## Purpose
Owns the PostgreSQL schema, tenant isolation model, Row-Level Security policies, and secure persistence of third-party integration credentials for Ikamva Virtual Admin Assist.

## Ownership
This document governs files in `database/`, including database initialization scripts, schema migrations, RLS policies, and database-facing authentication assumptions.

## Local Contracts
- Rule 1: Strict Multi-Tenancy. All queries must map to a `client_id` linked to the authenticated session.
- Rule 2: Token Privacy. Third-party OAuth tokens from Google or Microsoft must be securely encrypted before persistence and must never be stored in plain text.
- Every tenant-owned table must enable and force Row-Level Security.
- RLS policies must use a verified session-scoped `client_id`; application code must set that value only after authentication token verification.
- Schema changes that add tenant-owned tables must include matching `client_id` foreign keys and RLS policies in the same change.

## Work Guidance
- Store encrypted token ciphertext only; do not introduce columns named or intended for plain OAuth access or refresh tokens.
- Keep tenant-owned records anchored to `clients.id` through `client_id` foreign keys.
- Store client SOP rules on the owning `clients` row and access them only inside a verified tenant session.
- Prefer explicit status and provider constraints so queue and integration behavior remains predictable.
- Keep task failure details in structured queue log columns; do not store secrets or raw OAuth tokens in task logs.
- Keep production delivery receipts in structured task delivery logs after a manually approved external execution.

## Verification
- Review `schema.sql` to confirm all tenant-owned tables have RLS enabled, forced, and scoped by the verified session `client_id`.

## Child DOX Index
