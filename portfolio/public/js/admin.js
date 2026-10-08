/* Admin panel: authentication, project CRUD, and message inbox. */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const loginView = $('#login-view');
const dashboardView = $('#dashboard-view');
const loginForm = $('#login-form');
const loginStatus = $('#login-status');
const currentUserEl = $('#current-user');
const logoutBtn = $('#logout-btn');
const projectsList = $('#projects-list');
const messagesList = $('#messages-list');
const projectForm = $('#project-form');
const projectFormTitle = $('#project-form-title');
const projectStatus = $('#project-status');
const newProjectBtn = $('#new-project-btn');
const cancelProjectBtn = $('#cancel-project-btn');
const refreshMessagesBtn = $('#refresh-messages-btn');
const msgBadge = $('#msg-badge');

let cachedProjects = [];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function setStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('is-error', 'is-success');
  if (kind) el.classList.add(kind);
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function showLogin() {
  loginView.hidden = false;
  dashboardView.hidden = true;
}

function showDashboard(username) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  currentUserEl.textContent = username || '—';
  loadProjects();
  loadMessages();
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

async function checkSession() {
  try {
    const me = await api('/api/me');
    showDashboard(me.username);
  } catch {
    showLogin();
  }
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(loginStatus, '');

  const data = new FormData(loginForm);
  const username = String(data.get('username') || '').trim();
  const password = String(data.get('password') || '');

  if (!username || !password) {
    setStatus(loginStatus, 'Username and password are required.', 'is-error');
    return;
  }

  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    loginForm.reset();
    showDashboard(result.username);
  } catch (err) {
    setStatus(loginStatus, err.message || 'Sign-in failed.', 'is-error');
  } finally {
    submit.disabled = false;
  }
});

logoutBtn?.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  showLogin();
});

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    $('#tab-projects').hidden = target !== 'projects';
    $('#tab-messages').hidden = target !== 'messages';
  });
});

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

function renderProjects() {
  if (!cachedProjects.length) {
    projectsList.innerHTML = '<p class="empty-state">No projects yet. Create one above.</p>';
    return;
  }

  projectsList.innerHTML = cachedProjects
    .map((p) => {
      const tags = (p.tags || []).join(', ');
      return `
        <article class="admin-item" data-id="${p.id}">
          <div class="admin-item-header">
            <div>
              <h4>${escapeHtml(p.title)}</h4>
              <p>${escapeHtml(p.summary)}</p>
            </div>
            <div class="admin-item-actions">
              <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${p.id}">Edit</button>
              <button class="btn btn-danger btn-sm" data-action="delete" data-id="${p.id}">Delete</button>
            </div>
          </div>
          <div class="admin-item-meta">
            <span>#${p.id}</span>
            <span>order: ${p.sort_order}</span>
            ${tags ? `<span>tags: ${escapeHtml(tags)}</span>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadProjects() {
  projectsList.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const projects = await api('/api/admin/projects');
    cachedProjects = Array.isArray(projects) ? projects : [];
    renderProjects();
  } catch (err) {
    if (err.status === 401) return showLogin();
    projectsList.innerHTML = `<p class="empty-state">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function fillProjectForm(project) {
  projectForm.hidden = false;
  projectFormTitle.textContent = project ? `Edit Project #${project.id}` : 'New Project';
  projectForm.elements.id.value = project ? String(project.id) : '';
  projectForm.elements.title.value = project ? project.title : '';
  projectForm.elements.summary.value = project ? project.summary : '';
  projectForm.elements.description.value = project ? project.description || '' : '';
  projectForm.elements.highlights.value = project ? (project.highlights || []).join('\n') : '';
  projectForm.elements.repo_url.value = project ? project.repo_url || '' : '';
  projectForm.elements.demo_url.value = project ? project.demo_url || '' : '';
  projectForm.elements.image_url.value = project ? project.image_url || '' : '';
  projectForm.elements.tags.value = project ? (project.tags || []).join(', ') : '';
  projectForm.elements.sort_order.value = project ? String(project.sort_order ?? 0) : '0';
  setStatus(projectStatus, '');
  projectForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  projectForm.elements.title.focus();
}

function closeProjectForm() {
  projectForm.hidden = true;
  projectForm.reset();
  projectForm.elements.id.value = '';
  setStatus(projectStatus, '');
}

newProjectBtn?.addEventListener('click', () => fillProjectForm(null));
cancelProjectBtn?.addEventListener('click', () => closeProjectForm());

projectForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(projectStatus, '');

  const fd = new FormData(projectForm);
  const id = String(fd.get('id') || '').trim();

  const payload = {
    title: String(fd.get('title') || '').trim(),
    summary: String(fd.get('summary') || '').trim(),
    description: String(fd.get('description') || '').trim(),
    highlights: String(fd.get('highlights') || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    repo_url: String(fd.get('repo_url') || '').trim(),
    demo_url: String(fd.get('demo_url') || '').trim(),
    image_url: String(fd.get('image_url') || '').trim(),
    tags: String(fd.get('tags') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sort_order: Number(fd.get('sort_order') || 0) || 0
  };

  const submit = projectForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Saving…';

  try {
    if (id) {
      await api(`/api/admin/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setStatus(projectStatus, 'Project updated.', 'is-success');
    } else {
      await api('/api/admin/projects', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setStatus(projectStatus, 'Project created.', 'is-success');
    }
    await loadProjects();
    setTimeout(() => closeProjectForm(), 500);
  } catch (err) {
    if (err.status === 401) return showLogin();
    setStatus(projectStatus, err.message || 'Save failed.', 'is-error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Save Project';
  }
});

projectsList?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const project = cachedProjects.find((p) => p.id === id);
  if (!project) return;

  if (button.dataset.action === 'edit') {
    fillProjectForm(project);
    return;
  }

  if (button.dataset.action === 'delete') {
    if (!window.confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      await api(`/api/admin/projects/${id}`, { method: 'DELETE' });
      await loadProjects();
    } catch (err) {
      if (err.status === 401) return showLogin();
      window.alert(err.message || 'Delete failed.');
      button.disabled = false;
    }
  }
});

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

function renderMessages(messages) {
  if (!messages.length) {
    messagesList.innerHTML = '<p class="empty-state">No messages yet.</p>';
    msgBadge.hidden = true;
    return;
  }

  msgBadge.hidden = false;
  msgBadge.textContent = String(messages.length);

  messagesList.innerHTML = messages
    .map((m) => `
      <article class="admin-item" data-id="${m.id}">
        <div class="admin-item-header">
          <div>
            <h4>${escapeHtml(m.subject || '(no subject)')}</h4>
            <p>${escapeHtml(m.name)} &lt;${escapeHtml(m.email)}&gt;</p>
          </div>
          <div class="admin-item-actions">
            <a class="btn btn-ghost btn-sm" href="mailto:${escapeHtml(m.email)}">Reply</a>
            <button class="btn btn-danger btn-sm" data-action="delete-message" data-id="${m.id}">Delete</button>
          </div>
        </div>
        <div class="admin-item-meta">
          <span>#${m.id}</span>
          <span>${escapeHtml(m.created_at)}</span>
          ${m.ip ? `<span>ip: ${escapeHtml(m.ip)}</span>` : ''}
        </div>
        <pre>${escapeHtml(m.message)}</pre>
      </article>
    `)
    .join('');
}

async function loadMessages() {
  messagesList.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const messages = await api('/api/admin/messages');
    renderMessages(Array.isArray(messages) ? messages : []);
  } catch (err) {
    if (err.status === 401) return showLogin();
    messagesList.innerHTML = `<p class="empty-state">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

refreshMessagesBtn?.addEventListener('click', () => loadMessages());

messagesList?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="delete-message"]');
  if (!button) return;
  const id = Number(button.dataset.id);
  if (!window.confirm('Delete this message?')) return;
  button.disabled = true;
  try {
    await api(`/api/admin/messages/${id}`, { method: 'DELETE' });
    await loadMessages();
  } catch (err) {
    if (err.status === 401) return showLogin();
    window.alert(err.message || 'Delete failed.');
    button.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

checkSession();