'use strict';

const API = {
  googleAuth: '/integrations/google/auth',
  uploadTasks: '/tasks/bulk-upload',
  clientTasks: '/tasks',
  reviewTasks: '/admin/tasks?status=needs_review',
  approveTask: '/api/approve',
};

const SAMPLE_CLIENT_TASKS = [
  { id: 'tsk_101', task_type: 'Lead confirmation emails', status: 'pending', created_at: '2026-06-25T08:40:00Z' },
  { id: 'tsk_102', task_type: 'CRM enrichment batch', status: 'needs_review', created_at: '2026-06-25T09:10:00Z' },
  { id: 'tsk_103', task_type: 'Supplier follow-up', status: 'completed', created_at: '2026-06-25T10:20:00Z' },
];

const SAMPLE_REVIEW_TASKS = [
  {
    id: 'tsk_102',
    client_name: 'Demo Client',
    task_type: 'Lead confirmation emails',
    status: 'needs_review',
    result: {
      ai: {
        payload: {
          output_payload: {
            email: {
              to: 'lead@example.com',
              from: 'ops@ikamva.example',
              subject: 'Confirmation for your consultation',
              body: 'Hi Thandi,\\n\\nYour consultation is confirmed for Thursday at 14:00. Please reply if anything needs to change.\\n\\nKind regards,\\nIkamva Virtual Admin Assist',
            },
          },
        },
        supervisor: {
          reason: 'Matches SOP tone and contains no unsupported pricing.',
        },
      },
    },
    client_id: '00000000-0000-0000-0000-000000000000',
  },
];

function getStatusClass(status) {
  return `status-pill status-${String(status).replace(/[^a-z_]/g, '')}`;
}

function formatStatus(status) {
  return String(status).replace('_', ' ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}

function taskCounts(tasks) {
  return tasks.reduce((counts, task) => {
    counts[task.status] = (counts[task.status] || 0) + 1;
    return counts;
  }, {});
}

function renderClientTasks(tasks) {
  const list = document.querySelector('[data-task-list]');
  const counts = taskCounts(tasks);
  const completed = counts.completed || 0;
  const total = Math.max(tasks.length, 1);
  const progress = Math.round((completed / total) * 100);

  document.querySelector('[data-count-pending]').textContent = counts.pending || 0;
  document.querySelector('[data-count-review]').textContent = counts.needs_review || 0;
  document.querySelector('[data-count-completed]').textContent = completed;
  document.querySelector('[data-progress-fill]').style.width = `${progress}%`;

  list.innerHTML = tasks.map((task) => `
    <article class="task-row">
      <div>
        <div class="task-title">${escapeHtml(task.task_type)}</div>
        <div class="muted">${escapeHtml(task.id)}</div>
      </div>
      <span class="${getStatusClass(task.status)}">${escapeHtml(formatStatus(task.status))}</span>
    </article>
  `).join('');
}

async function loadClientDashboard() {
  const connect = document.querySelector('[data-connect-gmail]');
  const dropzone = document.querySelector('[data-dropzone]');
  const fileInput = document.querySelector('[data-file-input]');
  const uploadStatus = document.querySelector('[data-upload-status]');

  connect.href = API.googleAuth;

  try {
    renderClientTasks(await fetchJson(API.clientTasks));
  } catch {
    renderClientTasks(SAMPLE_CLIENT_TASKS);
  }

  const uploadFiles = async (files) => {
    if (!files.length) {
      return;
    }

    const form = new FormData();
    [...files].forEach((file) => form.append('files', file));
    uploadStatus.textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'}...`;

    try {
      await fetchJson(API.uploadTasks, {
        method: 'POST',
        body: form,
      });
      uploadStatus.textContent = 'Upload queued';
      renderClientTasks(await fetchJson(API.clientTasks));
    } catch {
      uploadStatus.textContent = 'Upload endpoint pending';
    }
  };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragging');
    uploadFiles(event.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => uploadFiles(fileInput.files));
}

function getDraftText(task) {
  const payload = task.result?.ai?.payload?.output_payload;
  const email = payload?.email || payload?.emails?.[0] || payload;

  if (!email) {
    return 'No draft payload available.';
  }

  if (email.body) {
    return [
      `To: ${email.to || ''}`,
      `Subject: ${email.subject || ''}`,
      '',
      email.body,
    ].join('\\n');
  }

  return JSON.stringify(email, null, 2);
}

function renderReviewTasks(tasks) {
  const list = document.querySelector('[data-review-list]');

  if (!tasks.length) {
    list.innerHTML = '<div class="notice">No tasks are waiting for review.</div>';
    return;
  }

  list.innerHTML = tasks.map((task) => `
    <article class="review-item">
      <div class="panel-header">
        <div>
          <h3>${escapeHtml(task.task_type)}</h3>
          <p class="muted">${escapeHtml(task.client_name || task.client_id || 'Client')} · ${escapeHtml(task.id)}</p>
        </div>
        <span class="${getStatusClass(task.status)}">${escapeHtml(formatStatus(task.status))}</span>
      </div>
      <div class="draft-layout">
        <div class="draft-box">
          <h3>Supervisor</h3>
          <p class="muted">${escapeHtml(task.result?.ai?.supervisor?.reason || 'Approved for human review.')}</p>
        </div>
        <div class="draft-box">
          <h3>Draft</h3>
          <pre class="draft-body">${escapeHtml(getDraftText(task))}</pre>
        </div>
      </div>
      <div class="toolbar">
        <button class="button primary" data-approve-task="${escapeHtml(task.id)}" data-client-id="${escapeHtml(task.client_id || '')}">Approve and Send</button>
        <button class="button secondary" data-hold-task="${escapeHtml(task.id)}">Keep in Review</button>
      </div>
    </article>
  `).join('');
}

async function loadAdminDashboard() {
  const list = document.querySelector('[data-review-list]');

  try {
    renderReviewTasks(await fetchJson(API.reviewTasks));
  } catch {
    renderReviewTasks(SAMPLE_REVIEW_TASKS);
  }

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-approve-task]');

    if (!button) {
      return;
    }

    button.disabled = true;
    button.textContent = 'Sending';

    try {
      await fetchJson(API.approveTask, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: button.dataset.approveTask,
          clientId: button.dataset.clientId,
        }),
      });
      button.textContent = 'Sent';
      renderReviewTasks(await fetchJson(API.reviewTasks));
    } catch {
      button.textContent = 'Endpoint pending';
    } finally {
      button.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page === 'client-dashboard') {
    loadClientDashboard();
  }

  if (document.body.dataset.page === 'admin-dashboard') {
    loadAdminDashboard();
  }
});
