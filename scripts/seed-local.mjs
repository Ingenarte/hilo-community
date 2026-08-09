#!/usr/bin/env node
/**
 * Hilo · local staging seed
 *
 * Creates two deterministic accounts and 3 sample tickets in the local
 * staging DB. Designed to run inside the hilo-local container:
 *
 *   docker exec hilo-local node /app/scripts/seed-local.mjs
 *
 * Or via pnpm script:
 *   pnpm stage:seed
 *
 * Idempotent — uses INSERT OR IGNORE / ON CONFLICT DO UPDATE so re-running
 * does not duplicate rows. Safe to run after `pnpm stage:reset`.
 *
 * Credentials created:
 *   admin@local.test  /  admin-local-pw  (role=admin)
 *   user@local.test   /  user-local-pw   (role=user)
 *
 * Project: "Local Test" (slug: local-test)
 * Tickets: 3 open tickets owned by user@local.test, each with one message
 */

import Database from 'better-sqlite3';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const scrypt = promisify(scryptCb);

// When running inside the container the DB lives at /data/hilo.db.
// For local dev outside Docker use DB_PATH env var to override.
const DB_PATH = process.env.DB_PATH ?? '/data/hilo.db';

// Wait until the DB file exists (the server creates it on first boot).
async function waitForDb(path, maxWaitMs = 30_000) {
  const step = 500;
  let elapsed = 0;
  while (!existsSync(path)) {
    if (elapsed >= maxWaitMs) {
      throw new Error(`DB not found at ${path} after ${maxWaitMs}ms. Is the server running?`);
    }
    await new Promise((r) => setTimeout(r, step));
    elapsed += step;
  }
}

// Matches the format used by src/lib/server/password.ts
// Format: scrypt$N=16384,r=8,p=1$<salt-base64>$<hash-base64>
async function hashPassword(plain) {
  const N = 16384;
  const KEYLEN = 64;
  const SALT_BYTES = 16;
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(plain, salt, KEYLEN);
  return `scrypt$N=${N},r=8,p=1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function main() {
  await waitForDb(DB_PATH);

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // ── Admin user: admin@local.test ──────────────────────────────────────────────
  const adminHash = await hashPassword('admin-local-pw');
  db.prepare(
    `INSERT INTO users (email, role, password_hash, theme, accent)
     VALUES (?, 'admin', ?, 'dark', 'violet')
     ON CONFLICT(email) DO UPDATE
       SET password_hash = excluded.password_hash,
           role = 'admin'`
  ).run('admin@local.test', adminHash);

  const adminRow = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('admin@local.test');
  const adminId = adminRow.id;

  // ── Regular user: user@local.test ─────────────────────────────────────────────
  const userHash = await hashPassword('user-local-pw');
  db.prepare(
    `INSERT INTO users (email, role, password_hash, theme, accent)
     VALUES (?, 'user', ?, 'dark', 'violet')
     ON CONFLICT(email) DO UPDATE
       SET password_hash = excluded.password_hash,
           role = 'user'`
  ).run('user@local.test', userHash);

  const userRow = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('user@local.test');
  const userId = userRow.id;

  // ── Project: Local Test ──────────────────────────────────────────────────
  db.prepare(
    `INSERT INTO projects (name, slug)
     VALUES ('Local Test', 'local-test')
     ON CONFLICT(slug) DO UPDATE SET name = excluded.name`
  ).run();

  const projectRow = db
    .prepare('SELECT id FROM projects WHERE slug = ?')
    .get('local-test');
  const projectId = projectRow.id;

  // Assign admin and user to this project
  db.prepare(
    `INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)`
  ).run(adminId, projectId);
  db.prepare(
    `INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)`
  ).run(userId, projectId);

  // ── 3 sample tickets owned by user@local.test ─────────────────────────────────
  const ticketTitles = [
    'Sample ticket 1 — getting started',
    'Sample ticket 2 — feature request',
    'Sample ticket 3 — bug report'
  ];
  const ticketBodies = [
    'Hello! This is a sample ticket for e2e testing. Feel free to reply.',
    'I would love to see a dark mode option. Any plans for that?',
    'The export button throws an error on Firefox 128. Steps to reproduce: ...'
  ];

  let created = 0;
  for (let i = 0; i < ticketTitles.length; i++) {
    // Idempotent: skip if title already exists for this user
    const exists = db
      .prepare('SELECT id FROM tickets WHERE user_id = ? AND title = ?')
      .get(userId, ticketTitles[i]);
    if (exists) continue;

    const info = db
      .prepare(
        `INSERT INTO tickets (user_id, title, status, priority)
         VALUES (?, ?, 'open', 'normal')`
      )
      .run(userId, ticketTitles[i]);
    const ticketId = Number(info.lastInsertRowid);

    // Link ticket to project
    db.prepare(
      `INSERT OR IGNORE INTO ticket_projects (ticket_id, project_id) VALUES (?, ?)`
    ).run(ticketId, projectId);

    // Initial message from user
    db.prepare(
      `INSERT INTO messages (ticket_id, sender_id, sender_role, body)
       VALUES (?, ?, 'user', ?)`
    ).run(ticketId, userId, ticketBodies[i]);

    created++;
  }

  db.close();

  console.log('Seed complete.');
  console.log(`  Users:   admin@local.test (admin), user@local.test (user)`);
  console.log(`  Project: Local Test (id=${projectId})`);
  console.log(`  Tickets: ${created} new, ${ticketTitles.length - created} already existed`);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
