/* Public site: theme toggle, scroll progress, scroll reveal,
   project loading, view counter, and contact form submission. */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Theme toggle                                                        */
/* ------------------------------------------------------------------ */

(function initTheme() {
  const toggle = $('#theme-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('pf-theme', next);
    } catch {
      /* storage unavailable — ignore */
    }
  });
})();

/* ------------------------------------------------------------------ */
/* Scroll progress bar                                                 */
/* ------------------------------------------------------------------ */

(function initProgress() {
  const bar = $('#progress');
  if (!bar) return;

  let ticking = false;

  function update() {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, doc.scrollTop / scrollable)) : 0;
    bar.style.transform = `scaleX(${ratio})`;
    ticking = false;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();

/* ------------------------------------------------------------------ */
/* Scroll reveal                                                       */
/* ------------------------------------------------------------------ */

function observeReveals(root = document) {
  const targets = $$('[data-reveal]', root).filter((el) => !el.classList.contains('is-visible'));
  if (!targets.length) return;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );

  targets.forEach((el, index) => {
    // Stagger siblings slightly for a more natural entrance.
    el.style.transitionDelay = `${Math.min(index % 6, 5) * 45}ms`;
    observer.observe(el);
  });
}

/* ------------------------------------------------------------------ */
/* View counter                                                        */
/* ------------------------------------------------------------------ */

async function initViews() {
  const el = $('#view-count');
  if (!el) return;
  try {
    const res = await fetch('/api/views', { method: 'POST' });
    if (!res.ok) throw new Error('view request failed');
    const data = await res.json();
    el.textContent = Number(data.count || 0).toLocaleString();
  } catch {
    // Fall back to a read-only count; if that also fails, leave the dash.
    try {
      const res = await fetch('/api/views');
      const data = await res.json();
      el.textContent = Number(data.count || 0).toLocaleString();
    } catch {
      el.textContent = '0';
    }
  }
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderProjectCard(project) {
  const tags = (project.tags || [])
    .map((t) => `<span>${escapeHtml(t)}</span>`)
    .join('');

  const highlights = (project.highlights || [])
    .slice(0, 4)
    .map((h) => `<li>${escapeHtml(h)}</li>`)
    .join('');

  const links = [];
  if (project.repo_url) {
    links.push(
      `<a href="${escapeHtml(project.repo_url)}" target="_blank" rel="noopener">Code</a>`
    );
  }
  if (project.demo_url) {
    links.push(
      `<a href="${escapeHtml(project.demo_url)}" target="_blank" rel="noopener">Live Demo</a>`
    );
  }

  return `
    <article class="project-card" data-reveal>
      <h3>${escapeHtml(project.title)}</h3>
      <p class="project-summary">${escapeHtml(project.summary)}</p>
      ${highlights ? `<ul class="project-highlights">${highlights}</ul>` : ''}
      ${tags ? `<div class="project-tags">${tags}</div>` : ''}
      ${links.length ? `<div class="project-links">${links.join('')}</div>` : ''}
    </article>
  `;
}

async function initProjects() {
  const grid = $('#project-grid');
  if (!grid) return;

  try {
    const res = await fetch('/api/projects', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const projects = await res.json();

    if (!Array.isArray(projects) || projects.length === 0) {
      grid.innerHTML = '<p class="empty-state">No projects yet.</p>';
      grid.removeAttribute('aria-busy');
      return;
    }

    grid.innerHTML = projects.map(renderProjectCard).join('');
    grid.removeAttribute('aria-busy');
    observeReveals(grid);
  } catch (err) {
    console.error('[projects]', err);
    grid.innerHTML =
      '<p class="empty-state">Unable to load projects right now. Please refresh the page.</p>';
    grid.removeAttribute('aria-busy');
  }
}

/* ------------------------------------------------------------------ */
/* Contact form                                                        */
/* ------------------------------------------------------------------ */

function initContactForm() {
  const form = $('#contact-form');
  if (!form) return;
  const status = $('#form-status', form);
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    status.classList.remove('is-error', 'is-success');

    const data = new FormData(form);
    const payload = {
      name: String(data.get('name') || '').trim(),
      email: String(data.get('email') || '').trim(),
      subject: String(data.get('subject') || '').trim(),
      message: String(data.get('message') || '').trim(),
      website: String(data.get('website') || '').trim()
    };

    if (payload.name.length < 2) {
      status.textContent = 'Please enter your name.';
      status.classList.add('is-error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      status.textContent = 'Please enter a valid email address.';
      status.classList.add('is-error');
      return;
    }
    if (payload.message.length < 10) {
      status.textContent = 'Your message must be at least 10 characters.';
      status.classList.add('is-error');
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);

      form.reset();
      status.textContent = 'Thanks — your message was sent.';
      status.classList.add('is-success');
    } catch (err) {
      status.textContent = err.message || 'Something went wrong. Please try again.';
      status.classList.add('is-error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Footer year                                                         */
/* ------------------------------------------------------------------ */

function initYear() {
  const el = $('#year');
  if (el) el.textContent = String(new Date().getFullYear());
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  initTheme();
  initProgress();
  initYear();
  observeReveals();
  initProjects();
  initViews();
  initContactForm();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}