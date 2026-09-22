const path = require('path');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const baileys = require('@whiskeysockets/baileys');

const makeWASocket = baileys.default || baileys.makeWASocket;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;

const authDir = path.join(__dirname, '..', 'data', 'auth');
const logger = pino({ level: 'silent' });

const state = {
  sock: null,
  status: 'starting',
  qr: '',
  lastError: '',
};

let onIncoming = () => {};
let reconnectTimer = null;

async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth,
    logger,
    browser: Browsers.macOS('Desktop'),
    // Keep the phone receiving notifications normally.
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  state.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      state.qr = qr;
      state.status = 'waiting_qr';
      console.log('\n[whatsapp] امسح الباركود من واتساب > الأجهزة المرتبطة:\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'open') {
      state.qr = '';
      state.status = 'connected';
      state.lastError = '';
      console.log('[whatsapp] متصل.');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      state.status = loggedOut ? 'logged_out' : 'disconnected';
      state.lastError = lastDisconnect?.error?.message || '';

      if (loggedOut) {
        console.error(`[whatsapp] تم تسجيل الخروج. احذف ${authDir} وأعد التشغيل لمسح باركود جديد.`);
        return;
      }
      scheduleReconnect();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe || !msg.key.remoteJid?.endsWith('@s.whatsapp.net')) continue;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';
      if (text) {
        try {
          await onIncoming(msg.key.remoteJid, text);
        } catch (err) {
          console.error('[whatsapp] فشل معالجة رسالة واردة:', err.message);
        }
      }
    }
  });

  return sock;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  console.log('[whatsapp] انقطع الاتصال، إعادة المحاولة بعد 5 ثوانٍ...');
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connect();
    } catch (err) {
      state.lastError = err.message;
      scheduleReconnect();
    }
  }, 5000);
}

async function start(handlers = {}) {
  onIncoming = handlers.onIncoming || onIncoming;
  await connect();
}

function isConnected() {
  return state.status === 'connected' && Boolean(state.sock);
}

function getStatus() {
  return { status: state.status, hasQr: Boolean(state.qr), lastError: state.lastError };
}

function getQr() {
  return state.qr;
}

// Returns the resolved JID, or '' when the number has no WhatsApp account.
async function resolveJid(phone) {
  if (!isConnected()) throw new Error('WhatsApp غير متصل');
  const results = await state.sock.onWhatsApp(phone);
  const hit = Array.isArray(results) ? results.find((r) => r.exists) : null;
  return hit ? hit.jid : '';
}

async function sendText(jid, text) {
  if (!isConnected()) throw new Error('WhatsApp غير متصل');
  await state.sock.sendMessage(jid, { text });
}

module.exports = { start, isConnected, getStatus, getQr, resolveJid, sendText, authDir };
