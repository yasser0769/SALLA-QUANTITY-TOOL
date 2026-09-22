const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const db = require('./lib/db');
const wa = require('./lib/whatsapp');
const scheduler = require('./lib/scheduler');
const { verifySignature, extractCart, extractOrderPhone } = require('./lib/salla');
const { fromJid } = require('./lib/phone');
const { stages, optOutKeywords } = require('./config');

loadEnvFile(path.join(__dirname, '.env'));

const settings = {
  port: Number(process.env.PORT || 3100),
  webhookSecret: process.env.SALLA_WEBHOOK_SECRET || '',
  adminToken: process.env.ADMIN_TOKEN || '',
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '966',
  dailyLimit: Number(process.env.DAILY_LIMIT || 40),
  quietStart: Number(process.env.QUIET_HOURS_START || 22),
  quietEnd: Number(process.env.QUIET_HOURS_END || 9),
  timezone: process.env.TIMEZONE || 'Asia/Riyadh',
  dryRun: process.env.DRY_RUN === '1',
};

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readRawBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isAdmin(url, req) {
  if (!settings.adminToken) return false;
  const provided = url.searchParams.get('token') || req.headers['x-admin-token'] || '';
  return provided === settings.adminToken;
}

async function handleWebhook(req, res) {
  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return sendJson(res, 413, { error: 'payload_too_large' });
  }

  const signature = req.headers['x-salla-signature'];
  if (!verifySignature(raw, signature, settings.webhookSecret)) {
    console.warn('[webhook] توقيع غير صالح — تم الرفض');
    return sendJson(res, 401, { error: 'invalid_signature' });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' });
  }

  const event = payload.event || '';

  if (event === 'abandoned.cart.created') {
    const cart = extractCart(payload, settings.defaultCountryCode);
    if (!cart.cart_id) return sendJson(res, 200, { ok: true, skipped: 'no_cart_id' });
    if (!cart.phone) return sendJson(res, 200, { ok: true, skipped: 'no_valid_phone' });
    if (db.isBlocked(cart.phone)) return sendJson(res, 200, { ok: true, skipped: 'blocked' });

    db.saveCart(cart);
    db.scheduleStages(cart.cart_id, cart.created_at, stages);
    console.log(`[webhook] سلة متروكة ${cart.cart_id} → ${cart.phone} (${stages.length} مرحلة)`);
    return sendJson(res, 200, { ok: true, scheduled: stages.length });
  }

  if (event === 'order.created' || event === 'order.updated') {
    const phone = extractOrderPhone(payload, settings.defaultCountryCode);
    if (phone) {
      const cancelled = db.cancelForPhone(phone);
      if (cancelled) console.log(`[webhook] طلب من ${phone} → أُلغيت ${cancelled} رسالة معلّقة`);
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 200, { ok: true, ignored: event });
}

async function onIncomingMessage(jid, text) {
  const normalized = text.trim().toLowerCase();
  const optedOut = optOutKeywords.some((word) => normalized.includes(word.toLowerCase()));
  if (!optedOut) return;

  const phone = fromJid(jid);
  db.blockPhone(phone, 'طلب العميل الإيقاف');
  const cancelled = db.cancelForPhone(phone);
  console.log(`[optout] ${phone} أوقف الرسائل → أُلغيت ${cancelled} رسالة`);

  try {
    await wa.sendText(jid, 'تم إيقاف الرسائل التلقائية. شكراً لك 🌹');
  } catch (err) {
    console.error('[optout] تعذر إرسال التأكيد:', err.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/webhooks/salla') {
    return handleWebhook(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, whatsapp: wa.getStatus().status });
  }

  if (url.pathname.startsWith('/admin') || url.pathname === '/qr') {
    if (!isAdmin(url, req)) return sendJson(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'GET' && url.pathname === '/qr') {
    return sendJson(res, 200, {
      ...wa.getStatus(),
      qr: wa.getQr() || null,
      hint: 'الباركود يُطبع في سجل التشغيل (terminal). امسحه من واتساب > الأجهزة المرتبطة.',
    });
  }

  if (req.method === 'GET' && url.pathname === '/admin/stats') {
    return sendJson(res, 200, {
      whatsapp: wa.getStatus(),
      jobs: db.jobCounts(),
      sentLast24h: scheduler.sentLast24h(),
      dailyLimit: settings.dailyLimit,
      quietHoursNow: scheduler.inQuietHours(),
      dryRun: settings.dryRun,
    });
  }

  if (req.method === 'POST' && url.pathname === '/admin/block') {
    const phone = url.searchParams.get('phone') || '';
    if (!phone) return sendJson(res, 400, { error: 'phone_required' });
    db.blockPhone(phone, 'إيقاف يدوي');
    return sendJson(res, 200, { ok: true, cancelled: db.cancelForPhone(phone) });
  }

  return sendJson(res, 404, { error: 'not_found' });
});

function main() {
  if (!settings.webhookSecret) {
    console.error('SALLA_WEBHOOK_SECRET مفقود — انسخ .env.example إلى .env واملأه.');
    process.exit(1);
  }
  if (!settings.adminToken) {
    console.error('ADMIN_TOKEN مفقود — لازم تحمي /qr و /admin.');
    process.exit(1);
  }

  server.listen(settings.port, () => {
    console.log(`[server] يستمع على المنفذ ${settings.port}`);
    console.log(`[server] webhook: POST /webhooks/salla`);
    if (settings.dryRun) console.log('[server] وضع DRY_RUN — لن تُرسل رسائل فعلية.');
  });

  scheduler.start(settings);

  if (!settings.dryRun) {
    wa.start({ onIncoming: onIncomingMessage }).catch((err) => {
      console.error('[whatsapp] فشل بدء الاتصال:', err.message);
    });
  }
}

main();
