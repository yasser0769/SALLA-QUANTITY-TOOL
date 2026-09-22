const db = require('./db');
const wa = require('./whatsapp');
const { toJid } = require('./phone');
const { stages } = require('../config');

const TICK_MS = 30_000;
const JITTER_MIN_MS = 10_000;
const JITTER_MAX_MS = 30_000;

let running = false;
let timer = null;
let settings = {};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hourIn(timezone) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(new Date());
  return Number(hour) % 24;
}

// Quiet window may wrap past midnight (e.g. 22 -> 9).
function inQuietHours() {
  const { quietStart, quietEnd, timezone } = settings;
  if (quietStart === quietEnd) return false;
  const hour = hourIn(timezone);
  if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
  return hour >= quietStart || hour < quietEnd;
}

function sentLast24h() {
  return db.sentSince(Date.now() - 24 * 60 * 60 * 1000);
}

async function processJob(job) {
  const stage = stages[job.stage];
  if (!stage) {
    db.markSkipped(job.id, `stage ${job.stage} غير معرّف في config.js`);
    return false;
  }

  if (db.isBlocked(job.phone)) {
    db.markSkipped(job.id, 'العميل موقوف عن الرسائل');
    return false;
  }

  const body = stage.text({
    name: job.name,
    total: job.total,
    currency: job.currency,
    checkout_url: job.checkout_url,
  });

  if (settings.dryRun) {
    console.log(`[dry-run] ${job.phone} (مرحلة ${job.stage}):\n${body}\n`);
    db.markSent(job.id);
    return true;
  }

  let jid;
  try {
    jid = await wa.resolveJid(job.phone);
  } catch (err) {
    // Connection problem, not a bad number — leave it pending and retry next tick.
    console.error(`[scheduler] تعذر التحقق من ${job.phone}: ${err.message}`);
    return false;
  }

  if (!jid) {
    db.markSkipped(job.id, 'الرقم غير مسجل في واتساب');
    return false;
  }

  try {
    await wa.sendText(jid, body);
    db.markSent(job.id);
    console.log(`[scheduler] أُرسلت لـ ${job.phone} (مرحلة ${job.stage})`);
    return true;
  } catch (err) {
    db.markFailed(job.id, err.message);
    console.error(`[scheduler] فشل الإرسال لـ ${job.phone}: ${err.message}`);
    return false;
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    if (!settings.dryRun && !wa.isConnected()) return;
    if (inQuietHours()) return;

    const remaining = settings.dailyLimit - sentLast24h();
    if (remaining <= 0) return;

    const jobs = db.dueJobs(Date.now(), remaining);
    for (const job of jobs) {
      if (inQuietHours() || sentLast24h() >= settings.dailyLimit) break;
      const sent = await processJob(job);
      if (sent && !settings.dryRun) {
        // Spacing the sends out looks far less like a blast.
        await sleep(JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
      }
    }
  } catch (err) {
    console.error('[scheduler] خطأ غير متوقع:', err.message);
  } finally {
    running = false;
  }
}

function start(options) {
  settings = options;
  timer = setInterval(tick, TICK_MS);
  tick();
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { start, stop, sentLast24h, inQuietHours };
