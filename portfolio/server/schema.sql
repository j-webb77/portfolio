// SQLite database bootstrap: opens the connection, applies the schema,
// and seeds the admin user + six sample projects on first run.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(ROOT, process.env.DB_PATH)
  : path.join(ROOT, 'data', 'portfolio.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  summary      TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  highlights   TEXT    NOT NULL DEFAULT '[]',
  repo_url     TEXT,
  demo_url     TEXT,
  image_url    TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_sort ON projects(sort_order, id);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS project_tags (
  project_id INTEGER NOT NULL,
  tag_id     INTEGER NOT NULL,
  PRIMARY KEY (project_id, tag_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)     REFERENCES tags(id)     ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_tags_tag ON project_tags(tag_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON contact_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS page_views (
  path       TEXT    PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL
);

CREATE VIEW IF NOT EXISTS v_public_projects AS
SELECT
  p.id,
  p.title,
  p.summary,
  p.description,
  p.highlights,
  p.repo_url,
  p.demo_url,
  p.image_url,
  p.sort_order,
  (SELECT GROUP_CONCAT(t.name, ',')
     FROM project_tags pt
     JOIN tags t ON t.id = pt.tag_id
    WHERE pt.project_id = p.id) AS tags
FROM projects p
ORDER BY p.sort_order ASC, p.id ASC;
`;

export function initDb() {
  db.exec(SCHEMA);
  seedAdmin();
  seedProjects();
}

function seedAdmin() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM admins').get();
  if (c > 0) return;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || 'pasword123';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`[db] seeded admin user "${username}"`);
}

const SAMPLE_PROJECTS = [
  {
    title: 'TaskFlow API',
    summary:
      'REST backend for multi-tenant team task management with role-based access control and a full audit trail.',
    description:
      'TaskFlow powers shared workspaces where teams create boards, assign tasks, and track changes. It exposes a versioned REST API consumed by a web client and a mobile app.',
    highlights: [
      'Designed a normalized PostgreSQL schema with 14 tables and full referential integrity.',
      'Implemented JWT authentication with refresh-token rotation and per-route RBAC middleware.',
      'Cut p95 response time from 480 ms to 90 ms by adding composite indexes and rewriting hot queries.',
      'Shipped a Docker Compose dev environment plus a GitHub Actions CI pipeline.'
    ],
    repo_url: 'https://github.com/yourname/taskflow-api',
    demo_url: '',
    image_url: '',
    tags: ['node', 'express', 'postgresql', 'jwt', 'docker']
  },
  {
    title: 'LedgerLite',
    summary:
      'Personal finance tracker that imports bank CSVs, categorizes transactions, and charts monthly spending.',
    description:
      'LedgerLite is a self-hosted budgeting tool. It ingests CSV exports, applies user-defined rules, and renders interactive charts entirely client-side.',
    highlights: [
      'Built a rule engine that categorizes 95% of transactions without manual input.',
      'Wrote a streaming CSV parser that handles 100k-row files without blocking the UI.',
      'Added end-to-end encryption for the SQLite vault using a passphrase-derived key.'
    ],
    repo_url: 'https://github.com/yourname/ledgerlite',
    demo_url: 'https://ledgerlite.example.com',
    image_url: '',
    tags: ['typescript', 'react', 'sqlite', 'vite']
  },
  {
    title: 'InventorySync',
    summary:
      'Realtime inventory synchronization service that keeps warehouse, POS, and e-commerce stock levels consistent.',
    description:
      'InventorySync listens to change events from multiple systems and reconciles them through a single source of truth, broadcasting updates over WebSockets.',
    highlights: [
      'Modelled stock movements as an append-only ledger so every quantity is auditable.',
      'Used Redis pub/sub to fan out updates to thousands of concurrent WebSocket clients.',
      'Added idempotent event handlers so duplicate deliveries never double-count stock.'
    ],
    repo_url: 'https://github.com/yourname/inventorysync',
    demo_url: '',
    image_url: '',
    tags: ['node', 'websockets', 'redis', 'mysql']
  },
  {
    title: 'DevMetrics Dashboard',
    summary:
      'Analytics dashboard that aggregates Git history into review latency, cycle time, and bus-factor metrics.',
    description:
      'DevMetrics ingests commit and pull-request data from multiple repositories and presents engineering health metrics in a filterable dashboard.',
    highlights: [
      'Wrote a Git log parser that handles 50k commits in under three seconds.',
      'Designed a star schema in PostgreSQL so metric queries stay sub-second as data grows.',
      'Built reusable D3 chart components with accessible keyboard navigation.'
    ],
    repo_url: 'https://github.com/yourname/devmetrics',
    demo_url: 'https://devmetrics.example.com',
    image_url: '',
    tags: ['python', 'flask', 'postgresql', 'd3']
  },
  {
    title: 'ShopStream',
    summary:
      'E-commerce backend with cart, checkout, and Stripe integration, built as a modular Spring Boot service.',
    description:
      'ShopStream handles product catalog, cart sessions, order placement, and payment webhooks for a mid-size storefront.',
    highlights: [
      'Integrated Stripe Checkout with idempotent webhook handling for reliable order creation.',
      'Used optimistic locking to prevent overselling during flash sales.',
      'Covered critical order flows with integration tests against a Testcontainers Postgres instance.'
    ],
    repo_url: 'https://github.com/yourname/shopstream',
    demo_url: '',
    image_url: '',
    tags: ['java', 'spring-boot', 'postgresql', 'stripe']
  },
  {
    title: 'LogHawk',
    summary:
      'Single-binary CLI that tails, filters, and summarizes application logs using a SQL-like query language.',
    description:
      'LogHawk lets engineers query logs with expressions such as `level = "error" AND duration > 500` and streams matching lines with live aggregation.',
    highlights: [
      'Implemented a hand-written lexer and parser for the query language.',
      'Indexed log files into an embedded SQLite store for millisecond lookups.',
      'Kept the shipped binary under 8 MB with zero runtime dependencies.'
    ],
    repo_url: 'https://github.com/yourname/loghawk',
    demo_url: '',
    image_url: '',
    tags: ['go', 'sqlite', 'cli']
  }
];

function seedProjects() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM projects').get();
  if (c > 0) return;

  const insertProject = db.prepare(`
    INSERT INTO projects (title, summary, description, highlights, repo_url, demo_url, image_url, sort_order)
    VALUES (@title, @summary, @description, @highlights, @repo_url, @demo_url, @image_url, @sort_order)
  `);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const linkTag = db.prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)');

  const seed = db.transaction(() => {
    SAMPLE_PROJECTS.forEach((p, i) => {
      const info = insertProject.run({
        title: p.title,
        summary: p.summary,
        description: p.description,
        highlights: JSON.stringify(p.highlights),
        repo_url: p.repo_url || null,
        demo_url: p.demo_url || null,
        image_url: p.image_url || null,
        sort_order: i
      });
      for (const raw of p.tags) {
        const name = String(raw).trim().toLowerCase();
        if (!name) continue;
        insertTag.run(name);
        const tag = getTag.get(name);
        if (tag) linkTag.run(info.lastInsertRowid, tag.id);
      }
    });
  });
  seed();
  console.log(`[db] seeded ${SAMPLE_PROJECTS.length} sample projects`);
}

// Allow `node server/db.js --reset` to drop and rebuild the whole database.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--reset')) {
    db.exec(`
      DROP VIEW  IF EXISTS v_public_projects;
      DROP TABLE IF EXISTS project_tags;
      DROP TABLE IF EXISTS tags;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS contact_messages;
      DROP TABLE IF EXISTS page_views;
      DROP TABLE IF EXISTS admins;
    `);
    console.log('[db] dropped all tables');
  }
  initDb();
  console.log(`[db] ready at ${DB_PATH}`);
}