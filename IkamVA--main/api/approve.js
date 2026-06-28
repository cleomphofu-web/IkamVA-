'use strict';

const { Pool } = require('pg');
const { executeProductionTask } = require('../integrations/delivery');
const { withTenantSession } = require('../integrations/oauth');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the approval API.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  application_name: 'ikamva-api-approve',
});

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    req.on('error', reject);
  });
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function validateApprovalPayload(req, body) {
  const taskId = body.taskId || body.task_id;
  const clientId = body.clientId || body.client_id || getHeader(req, 'x-client-id');

  if (!taskId || typeof taskId !== 'string') {
    throw new Error('A string taskId is required.');
  }

  if (!clientId || typeof clientId !== 'string') {
    throw new Error('A verified clientId is required for tenant-scoped approval.');
  }

  return { taskId, clientId };
}

async function markTaskApproved(db, taskId, clientId) {
  return withTenantSession(db, clientId, async () => {
    const result = await db.query(
      `
        UPDATE app.tasks
        SET status = 'approved',
            updated_at = now()
        WHERE id = $1
          AND client_id = $2
          AND status = 'needs_review'
        RETURNING id, client_id, status
      `,
      [taskId, clientId]
    );

    if (!result.rows[0]) {
      throw new Error('Task must exist for this tenant and be in needs_review before approval.');
    }

    return result.rows[0];
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const db = await pool.connect();

  try {
    const body = await readRequestBody(req);
    const { taskId, clientId } = validateApprovalPayload(req, body);

    await markTaskApproved(db, taskId, clientId);

    const deliveryLog = await executeProductionTask(taskId, {
      db,
      clientId,
    });

    return sendJson(res, 200, {
      ok: true,
      taskId,
      status: 'completed',
      deliveryLog,
    });
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: {
        message: error.message,
        name: error.name,
      },
    });
  } finally {
    db.release();
  }
}

module.exports = handler;
module.exports.default = handler;
