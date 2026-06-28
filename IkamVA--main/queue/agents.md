# Queue & Processing Domain

## Purpose
Owns background task polling, sequential execution, outbound throttling, and durable failure handling for the persistent `tasks` queue ledger.

## Ownership
This document governs files in `queue/`, including worker loops, polling behavior, task state transitions, throttling wrappers, and queue error handling.

## Local Contracts
- Rule 1: No In-Memory Volatility. Incoming tasks must reside inside the persistent database queue ledger (`tasks` table) rather than local memory arrays.
- Rule 2: Outbound Throttle Mandate. To safeguard client domain reputations and external API thresholds, executions to third-party endpoints must be limited to a strict cadence, with a maximum of 1 execution per 30 seconds per client domain.
- Workers must preserve tenant boundaries by carrying the selected task `client_id` through every task query, status update, and error write.
- A failed task must not crash the worker loop; record the failure details on the task row and continue to the next eligible task.
- Queue workers must not perform production side effects such as sending emails or writing to external CRMs; those actions belong to dashboard-approved integration flows.

## Work Guidance
- Poll durable `pending` rows from the database, mark one row as `processing`, then execute only that claimed row.
- Keep rate-limit state scoped by `client_id`; never use global in-memory task arrays as the source of queue truth.
- Move successful AI-approved executions to `needs_review` so dashboard review can happen before completion.

## Verification
- Review worker logic to confirm it claims persistent `pending` tasks, uses a 30-second per-client delay, and records failures on `tasks.failure_log`.

## Child DOX Index
