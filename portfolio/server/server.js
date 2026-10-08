// Express application: public API, admin API, and static file serving.
import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { db, initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'pf_session';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

initDb();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

/* --------------------------------------------------------------------------
 * Session helpers — HMAC-signed cookie, no server-side session store needed.
 * ------------------------------------------------------------------------ */

function hmac(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function makeSession(username) {
  const payload = `${username}|${Date.now()}`;
  return `${payload}|${hmac(payload)}`;
}

function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('|');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = hmac(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const sep = payload.lastIndexOf('|');
  const username = payload.slice(0, sep);
  const issued = Number(payload.slice(sep + 1));
  if (!Number.isFinite(issued) || Date.now() - issued > SESSION_TTL_MS) return null;
  return username;
}

function requireAuth(req, res, next) {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

/* --------------------------------------------------------------------------
 * In-memory rate limiter for the public contact endpoint.
 * ------------------------------------------------------------------------ */

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 5;
const contactHits = new Map();

function contactLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const previous = contactHits.get(ip) || [];
  const recent = previous.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    return res.status(429).json({ error: 'Too many messages sent. Please try again later.' });
  }
  recent.push(now);
  contactHits.set(ip, recent);
  next();
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of contactHits) {
    const kept = times.filter((t) => now - t < RATE_WINDOW_MS);
    if (kept.length) contactHits.set(ip, kept);
    else contactHits.delete(ip);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

/* --------------------------------------------------------------------------
 * Utilities
 * ------------------------------------------------------------------------ */

function safeParseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function shapeProject(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    highlights: safeParseJson(row.highlights, []),
    repo_url: row.repo_url || '',
    demo_url: row.demo_url || '',
    image_url: row.image_url || '',
    sort_order: row.sort_order,
    tags: row.tags ? String(row.tags).split(',').filter(Boolean) : []
  };
}

function normalizeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

/* --------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------ */

app.get('/api/projects', (_req, res) => {
  const rows = db.prepare('SELECT * FROM v_public_projects').all();
  res.json(rows.map(shapeProject));
});

app.get('/api/views', (_req, res) => {
  const row = db.prepare("SELECT count FROM page_views WHERE path = '/'").get();
  res.json({ count: row ? row.count : 0 });
});

app.post('/api/views', (_req, res) => {
  db.prepare(`
    INSERT INTO page_views (path, count, first_seen, last_seen)
    VALUES ('/', 1, datetime('now'), datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      count = count + 1,
      last_seen = datetime('now')
  `).run();
  const row = db.prepare("SELECT count FROM page_views WHERE path = '/'").get();
  res.json({ count: row.count });
});

app.post('/api/contact', contactLimiter, (req, res) => {
  const body = req.body || {};

  // Honeypot: a hidden field named "website" that humans never fill in.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return res.json({ ok: true });
  }

  const name = normalizeString(body.name, 120);
  const email = normalizeString(body.email, 200);
  const subject = normalizeString(body.subject, 200);
  const message = normalizeString(body.message, 5000);

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (message.length < 10) {
    return res.status(400).json({ error: 'Message must be at least 10 characters.' });
  }

  const ip = req.ip || req.socket.remoteAddress || null;
  db.prepare(
    'INSERT INTO contact_messages (name, email, subject, message, ip) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email, subject, message, ip);

  res.json({ ok: true });
});

/* --------------------------------------------------------------------------
 * Auth API
 * ------------------------------------------------------------------------ */

app.post('/api/login', (req, res) => {
  const username = normalizeString(req.body?.username, 120);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  res.cookie(COOKIE_NAME, makeSession(username), {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ username: user });
});

/* --------------------------------------------------------------------------
 * Admin API — projects
 * ------------------------------------------------------------------------ */

const syncTags = db.transaction((projectId, tagList) => {
  db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const selectTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const linkTag = db.prepare(
    'INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)'
  );
  const seen = new Set();
  for (const raw of tagList) {
    const name = String(raw).trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    insertTag.run(name);
    const tag = selectTag.get(name);
    if (tag) linkTag.run(projectId, tag.id);
  }
});

function parseProjectPayload(body) {
  const title = normalizeString(body?.title, 200);
  const summary = normalizeString(body?.summary, 500);
  if (title.length < 2) throw new Error('Title is required.');
  if (summary.length < 5) throw new Error('Summary is required.');

  const highlights = Array.isArray(body?.highlights)
    ? body.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 12)
    : [];

  const tags = Array.isArray(body?.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
    : [];

  return {
    title,
    summary,
    description: normalizeString(body?.description, 4000),
    highlights: JSON.stringify(highlights),
    repo_url: normalizeString(body?.repo_url, 500) || null,
    demo_url: normalizeString(body?.demo_url, 500) || null,
    image_url: normalizeString(body?.image_url, 500) || null,
    sort_order: Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0,
    tags
  };
}

app.get('/api/admin/projects', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM v_public_projects').all();
  res.json(rows.map(shapeProject));
});

app.post('/api/admin/projects', requireAuth, (req, res) => {
  let payload;
  try {
    payload = parseProjectPayload(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const info = db
    .prepare(
      `INSERT INTO projects (title, summary, description, highlights, repo_url, demo_url, image_url, sort_order)
       VALUES (@title, @summary, @description, @highlights, @repo_url, @demo_url, @image_url, @sort_order)`
    )
    .run(payload);
  syncTags(info.lastInsertRowid, payload.tags);
  const row = db.prepare('SELECT * FROM v_public_projects WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(shapeProject(row));
});

app.put('/api/admin/projects/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Project not found.' });

  let payload;
  try {
    payload = parseProjectPayload(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `UPDATE projects SET
       title = @title,
       summary = @summary,
       description = @description,
       highlights = @highlights,
       repo_url = @repo_url,
       demo_url = @demo_url,
       image_url = @image_url,
       sort_order = @sort_order
     WHERE id = @id`
  ).run({ ...payload, id });

  syncTags(id, payload.tags);
  const row = db.prepare('SELECT * FROM v_public_projects WHERE id = ?').get(id);
  res.json(shapeProject(row));
});

app.delete('/api/admin/projects/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Project not found.' });
  res.json({ ok: true });
});

/* --------------------------------------------------------------------------
 * Admin API — messages
 * ------------------------------------------------------------------------ */

app.get('/api/admin/messages', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      'SELECT id, name, email, subject, message, ip, created_at FROM contact_messages ORDER BY created_at DESC, id DESC'
    )
    .all();
  res.json(rows);
});

app.delete('/api/admin/messages/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const info = db.prepare('DELETE FROM contact_messages WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

/* --------------------------------------------------------------------------
 * Static files
 * ------------------------------------------------------------------------ */

app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.(css|js)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      } else if (/\.(svg|png|jpg|jpeg|webp|ico|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      }
    }
  })
);

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  res.status(500).json({ error: 'Internal server error.' });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] listening on http://127.0.0.1:${PORT}`);
});

function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));