'use strict';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const WORKER_MODEL = process.env.IKAMVA_WORKER_MODEL || 'gpt-4o-mini';
const SUPERVISOR_MODEL = process.env.IKAMVA_SUPERVISOR_MODEL || 'gpt-4o-mini';

class AIValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'AIValidationError';
    this.details = details;
  }
}

function requireApiKey() {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for AI task processing.');
  }
}

async function callLLM({ model, messages, temperature = 0.2, responseFormat }) {
  requireApiKey();

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: responseFormat,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API request failed with ${response.status}: ${errorBody}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('LLM API response did not include message content.');
  }

  return content;
}

function parseJsonContent(content, label) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function buildWorkerMessages(taskData, clientSOP, supervisorFeedback) {
  const correctionInstruction = supervisorFeedback
    ? `\nSupervisor feedback to correct exactly once:\n${JSON.stringify(supervisorFeedback)}`
    : '';

  return [
    {
      role: 'system',
      content: [
        'You are the Worker Agent for Ikamva Virtual Admin Assist.',
        'Use only the task input and the client SOP provided in this request.',
        'Do not invent pricing, policies, facts, or commitments not present in the SOP or task payload.',
        'Return strict JSON with keys: task_summary, output_type, output_payload, assumptions.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Client SOP:\n${JSON.stringify(clientSOP)}`,
        `Task data:\n${JSON.stringify(taskData)}`,
        correctionInstruction,
      ].join('\n\n'),
    },
  ];
}

function buildSupervisorMessages(taskData, clientSOP, workerDraft) {
  return [
    {
      role: 'system',
      content: [
        'You are the Supervisor Auditor for Ikamva Virtual Admin Assist.',
        'Evaluate the Worker draft strictly against the client SOP and task data.',
        'Reject hallucinated facts, unsupported pricing, wrong tone, missing client constraints, or unsafe commitments.',
        'Return strict JSON with keys: approved, reason, issues, required_changes.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Client SOP:\n${JSON.stringify(clientSOP)}`,
        `Task data:\n${JSON.stringify(taskData)}`,
        `Worker draft:\n${JSON.stringify(workerDraft)}`,
      ].join('\n\n'),
    },
  ];
}

async function generateWorkerDraft(taskData, clientSOP, supervisorFeedback) {
  const content = await callLLM({
    model: WORKER_MODEL,
    messages: buildWorkerMessages(taskData, clientSOP, supervisorFeedback),
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
  });

  return parseJsonContent(content, 'Worker Agent');
}

async function auditWorkerDraft(taskData, clientSOP, workerDraft) {
  const content = await callLLM({
    model: SUPERVISOR_MODEL,
    messages: buildSupervisorMessages(taskData, clientSOP, workerDraft),
    temperature: 0,
    responseFormat: { type: 'json_object' },
  });

  const audit = parseJsonContent(content, 'Supervisor Agent');

  return {
    approved: audit.approved === true,
    reason: audit.reason || null,
    issues: Array.isArray(audit.issues) ? audit.issues : [],
    required_changes: Array.isArray(audit.required_changes)
      ? audit.required_changes
      : [],
  };
}

function buildApprovedResult(workerDraft, supervisorAudit, attempt) {
  return {
    approved: true,
    requires_human_intervention: false,
    attempt,
    payload: workerDraft,
    supervisor: supervisorAudit,
  };
}

function buildRejectedResult(workerDraft, supervisorAudit) {
  return {
    approved: false,
    requires_human_intervention: true,
    failure: {
      message: 'Supervisor rejected AI output after correction attempt.',
      requires_human_intervention: true,
      reason: supervisorAudit.reason,
      issues: supervisorAudit.issues,
      required_changes: supervisorAudit.required_changes,
      final_draft: workerDraft,
      occurred_at: new Date().toISOString(),
    },
  };
}

async function processTaskWithAI(taskData, clientSOP) {
  let taskContext = taskData;
  let sopContext = clientSOP;

  try {
    const firstDraft = await generateWorkerDraft(taskContext, sopContext);
    const firstAudit = await auditWorkerDraft(taskContext, sopContext, firstDraft);

    if (firstAudit.approved) {
      return buildApprovedResult(firstDraft, firstAudit, 1);
    }

    const correctedDraft = await generateWorkerDraft(taskContext, sopContext, firstAudit);
    const secondAudit = await auditWorkerDraft(taskContext, sopContext, correctedDraft);

    if (secondAudit.approved) {
      return buildApprovedResult(correctedDraft, secondAudit, 2);
    }

    return buildRejectedResult(correctedDraft, secondAudit);
  } finally {
    taskContext = null;
    sopContext = null;
  }
}

module.exports = {
  AIValidationError,
  processTaskWithAI,
};
