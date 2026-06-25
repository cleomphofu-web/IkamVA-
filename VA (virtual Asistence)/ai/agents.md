# AI Orchestration & Guardrails Domain

## Purpose
Owns per-task AI routing, isolated prompt construction, Worker/Supervisor validation, and feedback loops before queue results reach dashboard review.

## Ownership
This document governs files in `ai/`, including LLM client wrappers, prompt assembly, validation contracts, and AI result shapes returned to the queue worker.

## Local Contracts
- Rule 1: Ephemeral Context Erasure. The AI must never have a shared global memory across clients. Client SOPs and business data must be loaded dynamically per task execution and wiped instantly from memory after the response cycle.
- Rule 2: Twin-Agent Mandate. No generation from the Worker LLM can bypass validation. The Supervisor LLM must evaluate all output against the client's rules before it transitions to `needs_review`.
- AI outputs must include structured approval or rejection metadata so the queue can make deterministic status transitions.
- Failed validation after one correction attempt must return a structured failure for durable `tasks.failure_log` storage and human intervention.

## Work Guidance
- Keep prompts local to a single function call; do not cache client SOPs, task payloads, or model responses in module-level memory.
- Use a cost-optimized Worker model by default and a distinct Supervisor call for audit behavior, even when both calls use the same base model.
- Supervisor checks must cover hallucinations, accurate pricing, client constraints, and tone.

## Verification
- Review AI routing to confirm each task gets isolated prompt inputs, a mandatory Supervisor pass, one correction loop, and a structured failure after a second rejection.

## Child DOX Index
