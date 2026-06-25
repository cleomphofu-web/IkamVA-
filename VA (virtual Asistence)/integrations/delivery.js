'use strict';

const { google } = require('googleapis');
const {
  decryptSecret,
  withTenantSession,
} = require('./oauth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const CRM_ENDPOINT_URL = process.env.CRM_ENDPOINT_URL;

function requireGoogleConfig() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required.');
  }
}

function requireClientId(clientId) {
  if (!clientId) {
    throw new Error('A verified session client_id is required for production delivery.');
  }
}

function buildRawEmail({ to, from, subject, body }) {
  if (!to || !from || !subject || !body) {
    throw new Error('Gmail delivery requires to, from, subject, and body fields.');
  }

  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function loadApprovedTask(db, taskId, clientId) {
  return withTenantSession(db, clientId, async () => {
    const result = await db.query(
      `
        SELECT id, client_id, task_type, status, result
        FROM app.tasks
        WHERE id = $1
          AND client_id = $2
      `,
      [taskId, clientId]
    );

    const task = result.rows[0];

    if (!task) {
      throw new Error(`Task ${taskId} was not found for the verified tenant.`);
    }

    if (task.status !== 'approved') {
      throw new Error(`Task ${taskId} must be manually approved before production delivery.`);
    }

    return task;
  });
}

async function loadGoogleCredential(db, clientId) {
  return withTenantSession(db, clientId, async () => {
    const result = await db.query(
      `
        SELECT encrypted_refresh_token
        FROM app.integration_credentials
        WHERE client_id = $1
          AND provider = 'google'
      `,
      [clientId]
    );

    if (!result.rows[0]) {
      throw new Error('Google integration credentials are not connected for this tenant.');
    }

    return result.rows[0];
  });
}

async function getGmailClient(db, clientId) {
  requireGoogleConfig();

  const credential = await loadGoogleCredential(db, clientId);
  const refreshToken = decryptSecret(credential.encrypted_refresh_token);
  const auth = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  auth.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth });
}

function extractAIOutput(task) {
  const aiPayload = task.result?.ai?.payload?.output_payload;

  if (!aiPayload) {
    throw new Error(`Task ${task.id} does not contain a Twin-Agent output payload.`);
  }

  return aiPayload;
}

async function sendGmailPayload(db, task, clientId) {
  const gmail = await getGmailClient(db, clientId);
  const payload = extractAIOutput(task);
  const messages = Array.isArray(payload.emails) ? payload.emails : [payload.email || payload];
  const messageIds = [];

  for (const email of messages) {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildRawEmail(email),
      },
    });

    messageIds.push(response.data.id);
  }

  return {
    provider: 'google_gmail',
    transaction_ids: messageIds,
    delivered_count: messageIds.length,
  };
}

async function sendCrmPayload(task, crmEndpoint = CRM_ENDPOINT_URL) {
  if (!crmEndpoint) {
    throw new Error('CRM_ENDPOINT_URL is required for CRM delivery.');
  }

  const payload = extractAIOutput(task);
  const response = await fetch(crmEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`CRM delivery failed with ${response.status}: ${body}`);
  }

  const receipt = await response.json().catch(() => ({}));

  return {
    provider: 'external_crm',
    transaction_ids: [receipt.id || receipt.transaction_id || `crm-${Date.now()}`],
    delivered_count: 1,
    response: receipt,
  };
}

function resolveDeliveryRoute(task) {
  const explicitRoute = task.result?.ai?.payload?.output_type || task.task_type;
  const route = String(explicitRoute || '').toLowerCase();

  if (route.includes('crm')) {
    return 'crm';
  }

  return 'gmail';
}

async function recordDeliverySuccess(db, task, clientId, deliveryReceipt) {
  const deliveryLog = {
    ...deliveryReceipt,
    delivered_at: new Date().toISOString(),
  };

  await withTenantSession(db, clientId, async () => {
    await db.query(
      `
        UPDATE app.tasks
        SET status = 'completed',
            delivery_log = $3::jsonb,
            updated_at = now()
        WHERE id = $1
          AND client_id = $2
          AND status = 'approved'
      `,
      [task.id, clientId, JSON.stringify(deliveryLog)]
    );
  });

  return deliveryLog;
}

async function executeProductionTask(taskId, { db, clientId, crmEndpoint } = {}) {
  if (!db) {
    throw new Error('A database client is required.');
  }

  requireClientId(clientId);

  const task = await loadApprovedTask(db, taskId, clientId);
  const route = resolveDeliveryRoute(task);
  const receipt = route === 'crm'
    ? await sendCrmPayload(task, crmEndpoint)
    : await sendGmailPayload(db, task, clientId);

  return recordDeliverySuccess(db, task, clientId, receipt);
}

module.exports = {
  buildRawEmail,
  executeProductionTask,
  getGmailClient,
  sendCrmPayload,
  sendGmailPayload,
};
