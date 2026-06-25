'use strict';

const { pollOnce, serializeError } = require('../queue/worker');

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const processed = await pollOnce();

    return sendJson(res, 200, {
      ok: true,
      processed,
      route: '/api/cron',
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: serializeError(error),
    });
  }
}

module.exports = handler;
module.exports.default = handler;
