# Frontend Domain

## Purpose
Owns browser-based dashboard surfaces for clients and Ikamva admins, including Gmail connection entry points, bulk task upload, queue progress visibility, and AI draft review approval.

## Ownership
This document governs files in `frontend/`, including static dashboard pages, shared styles, and browser-side workflow scripts.

## Local Contracts
- Client UI must never expose OAuth secrets, raw tokens, service credentials, or tenant identifiers beyond authenticated backend session flows.
- Client uploads must target persistent backend task ingestion endpoints, not browser-only memory as the durable source of truth.
- Admin approval controls must call backend approval/delivery endpoints and must not directly call third-party APIs from the browser.
- Task states shown in the UI must align with backend statuses: `pending`, `needs_review`, `approved`, and `completed`.

## Work Guidance
- Keep pages operational and dashboard-first; avoid marketing layouts.
- Use calm, scan-friendly layouts for repeated workflows and status-heavy screens.
- Make backend endpoint paths easy to adjust from a single script configuration block.

## Verification
- Open the static HTML pages or inspect their scripts to confirm OAuth, upload, progress, review, and approval actions target backend endpoints rather than local-only persistence.

## Child DOX Index
