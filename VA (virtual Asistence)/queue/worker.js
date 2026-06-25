'use strict';

const { Pool } = require('pg');
const { processTaskWithAI } = require('../ai/routing');

const DATABASE_URL = process.env.DATABASE_URL;
const POLL_INTERVAL_MS = Number(process.env.QUEUE_POLL_INTERVAL_MS || 5000);
const CLIENT_THROTTLE_MS = Number(process.env.CLIENT_THROTTLE_MS || 30000);

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to start the queue worker.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  application_name: 'ikamva-queue-worker',
});

const lastExecutionByClient = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(error) {
  return {
    message: error.message,
    name: error.name,
    code: error.code,
    detail: error.detail,
    stack: error.stack,
    occurred_at: new Date().toISOString(),
  };
}

async function waitForClientCadence(clientId) {
  const lastExecution = lastExecutionByClient.get(clientId);

  if (!lastExecution) {
    return;
  }

  const elapsedMs = Date.now() - lastExecution;
  const remainingMs = CLIENT_THROTTLE_MS - elapsedMs;

  if (remainingMs > 0) {
    await sleep(remainingMs);
  }
}

async function withTenantSession(db, clientId, callback) {
  await db.query('BEGIN');

  try {
    await db.query('SELECT set_config($1, $2, true)', [
      'app.current_client_id',
      clientId,
    ]);
    const result = await callback();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function claimNextPendingTask(db) {
  const result = await db.query(`
    WITH next_task AS (
      SELECT id
      FROM app.tasks
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE app.tasks
    SET status = 'processing',
        failure_log = NULL,
        updated_at = now()
    WHERE id = (SELECT id FROM next_task)
    RETURNING id, client_id, task_type, payload, created_at
  `);

  return result.rows[0] || null;
}

async function fetchClientSOP(db, clientId) {
  return withTenantSession(db, clientId, async () => {
    const result = await db.query(
      `
        SELECT sop_rules
        FROM app.clients
        WHERE id = $1
      `,
      [clientId]
    );

    if (!result.rows[0]) {
      throw new Error(`Client SOP not found for client_id ${clientId}.`);
    }

    return result.rows[0].sop_rules;
  });
}

async function runBaseTaskLogic(db, task) {
  const clientSOP = await fetchClientSOP(db, task.client_id);

  const aiResult = await processTaskWithAI(
    {
      id: task.id,
      client_id: task.client_id,
      task_type: task.task_type,
      payload: task.payload,
      created_at: task.created_at,
    },
    clientSOP
  );

  if (!aiResult.approved) {
    const error = new Error(aiResult.failure.message);
    error.name = 'AIValidationError';
    error.detail = aiResult.failure;
    throw error;
  }

  return {
    task_id: task.id,
    task_type: task.task_type,
    processed_at: new Date().toISOString(),
    ai: aiResult,
  };
}

async function markTaskNeedsReview(db, task, result) {
  await withTenantSession(db, task.client_id, async () => {
    await db.query(
      `
        UPDATE app.tasks
        SET status = 'needs_review',
            result = $3::jsonb,
            failure_log = NULL,
            updated_at = now()
        WHERE id = $1
          AND client_id = $2
          AND status = 'processing'
      `,
      [task.id, task.client_id, JSON.stringify(result)]
    );
  });
}

async function markTaskFailed(db, task, error) {
  const failureLog = serializeError(error);

  await withTenantSession(db, task.client_id, async () => {
    await db.query(
      `
        UPDATE app.tasks
        SET status = 'failed',
            failure_log = $3::jsonb,
            updated_at = now()
        WHERE id = $1
          AND client_id = $2
      `,
      [task.id, task.client_id, JSON.stringify(failureLog)]
    );
  });
}

async function processTask(db, task) {
  await waitForClientCadence(task.client_id);

  try {
    const result = await runBaseTaskLogic(db, task);
    await markTaskNeedsReview(db, task, result);
  } catch (error) {
    await markTaskFailed(db, task, error);
  } finally {
    lastExecutionByClient.set(task.client_id, Date.now());
  }
}

async function pollOnce() {
  const db = await pool.connect();

  try {
    const task = await claimNextPendingTask(db);

    if (!task) {
      return false;
    }

    await processTask(db, task);
    return true;
  } catch (error) {
    console.error('Queue poll failed', serializeError(error));
    return false;
  } finally {
    db.release();
  }
}

async function runWorker() {
  console.info('Ikamva queue worker started.');

  while (true) {
    const processedTask = await pollOnce();

    if (!processedTask) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

process.on('SIGINT', async () => {
  console.info('Stopping Ikamva queue worker.');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.info('Stopping Ikamva queue worker.');
  await pool.end();
  process.exit(0);
});

if (require.main === module) {
  runWorker().catch(async (error) => {
    console.error('Queue worker crashed', serializeError(error));
    await pool.end();
    process.exit(1);
  });
}

module.exports = {
  pollOnce,
  runWorker,
  sleep,
  serializeError,
};
