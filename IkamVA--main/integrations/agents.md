# Third-Party Integration Domain

## Purpose
Owns Google OAuth token exchange, encrypted credential persistence, third-party API client initialization, manual production approval enforcement, and delivery receipt logging.

## Ownership
This document governs files in `integrations/`, including OAuth handlers, credential encryption/decryption, Gmail delivery execution, CRM delivery routing, and production side-effect guards.

## Local Contracts
- Rule 1: Invisible Credential Tokenization. Under no circumstances should raw API secrets or client passwords bypass the encrypted `integration_credentials` database table.
- Rule 2: Non-Autonomous Production Side-Effects. No outbound API execution, including sending emails or writing to external CRMs, may trigger automatically from the queue worker. It must wait for the task status to shift from `needs_review` to `approved` via a dashboard interaction.
- Integration code must anchor every credential read/write and task delivery update to the verified session `client_id`.
- Successful external delivery must write a durable third-party transaction or message ID to `tasks.delivery_log` before transitioning the task to `completed`.

## Work Guidance
- Store only encrypted OAuth token ciphertext; keep plaintext tokens scoped to the shortest possible local function lifetime.
- Use Google Gmail scopes narrowly: `gmail.modify` and `gmail.send`.
- Keep delivery modules callable only from dashboard approval flows or explicit backend approval handlers, never from the queue worker.

## Verification
- Review OAuth code to confirm tokens are encrypted before database writes and never logged.
- Review delivery code to confirm it refuses non-`approved` tasks and records provider receipts before marking `completed`.

## Child DOX Index
