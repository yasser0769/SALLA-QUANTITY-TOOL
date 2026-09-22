const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'carts.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS carts (
    cart_id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    name TEXT,
    total TEXT,
    currency TEXT,
    checkout_url TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id TEXT NOT NULL,
    stage INTEGER NOT NULL,
    send_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    sent_at INTEGER,
    error TEXT,
    UNIQUE (cart_id, stage)
  );

  CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status, send_at);
  CREATE INDEX IF NOT EXISTS jobs_sent_at ON jobs (sent_at);

  CREATE TABLE IF NOT EXISTS blocklist (
    phone TEXT PRIMARY KEY,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
`);

const stmt = {
  insertCart: db.prepare(`
    INSERT INTO carts (cart_id, phone, name, total, currency, checkout_url, created_at)
    VALUES (@cart_id, @phone, @name, @total, @currency, @checkout_url, @created_at)
    ON CONFLICT (cart_id) DO UPDATE SET
      phone = excluded.phone,
      name = excluded.name,
      total = excluded.total,
      currency = excluded.currency,
      checkout_url = excluded.checkout_url
  `),
  insertJob: db.prepare(`
    INSERT INTO jobs (cart_id, stage, send_at)
    VALUES (?, ?, ?)
    ON CONFLICT (cart_id, stage) DO NOTHING
  `),
  dueJobs: db.prepare(`
    SELECT j.id, j.cart_id, j.stage, c.phone, c.name, c.total, c.currency, c.checkout_url
    FROM jobs j
    JOIN carts c ON c.cart_id = j.cart_id
    WHERE j.status = 'pending' AND j.send_at <= ?
    ORDER BY j.send_at ASC
    LIMIT ?
  `),
  markSent: db.prepare(`UPDATE jobs SET status = 'sent', sent_at = ? WHERE id = ?`),
  markFailed: db.prepare(`UPDATE jobs SET status = 'failed', error = ? WHERE id = ?`),
  markSkipped: db.prepare(`UPDATE jobs SET status = 'skipped', error = ? WHERE id = ?`),
  cancelByPhone: db.prepare(`
    UPDATE jobs SET status = 'cancelled'
    WHERE status = 'pending'
      AND cart_id IN (SELECT cart_id FROM carts WHERE phone = ?)
  `),
  cancelByCart: db.prepare(`UPDATE jobs SET status = 'cancelled' WHERE status = 'pending' AND cart_id = ?`),
  sentSince: db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'sent' AND sent_at >= ?`),
  block: db.prepare(`INSERT OR IGNORE INTO blocklist (phone, reason, created_at) VALUES (?, ?, ?)`),
  isBlocked: db.prepare(`SELECT 1 FROM blocklist WHERE phone = ?`),
  counts: db.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`),
};

function saveCart(cart) {
  stmt.insertCart.run(cart);
}

function scheduleStages(cartId, createdAt, stages) {
  stages.forEach((stage, index) => {
    stmt.insertJob.run(cartId, index, createdAt + stage.delayMinutes * 60_000);
  });
}

function dueJobs(now, limit) {
  return stmt.dueJobs.all(now, limit);
}

function markSent(id) {
  stmt.markSent.run(Date.now(), id);
}

function markFailed(id, error) {
  stmt.markFailed.run(String(error).slice(0, 500), id);
}

function markSkipped(id, reason) {
  stmt.markSkipped.run(String(reason).slice(0, 500), id);
}

function cancelForPhone(phone) {
  return stmt.cancelByPhone.run(phone).changes;
}

function cancelForCart(cartId) {
  return stmt.cancelByCart.run(cartId).changes;
}

function sentSince(timestamp) {
  return stmt.sentSince.get(timestamp).n;
}

function blockPhone(phone, reason) {
  stmt.block.run(phone, reason, Date.now());
}

function isBlocked(phone) {
  return Boolean(stmt.isBlocked.get(phone));
}

function jobCounts() {
  const out = {};
  for (const row of stmt.counts.all()) out[row.status] = row.n;
  return out;
}

module.exports = {
  saveCart,
  scheduleStages,
  dueJobs,
  markSent,
  markFailed,
  markSkipped,
  cancelForPhone,
  cancelForCart,
  sentSince,
  blockPhone,
  isBlocked,
  jobCounts,
};
