const crypto = require('crypto');
const { normalizePhone } = require('./phone');

// Salla signs the raw request body with the webhook secret (HMAC-SHA256, hex).
function verifySignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(header).trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

// Salla's abandoned cart payload has shifted between versions, so read defensively.
function extractCart(payload, defaultCountryCode) {
  const data = (payload && payload.data) || {};
  const customer = data.customer || {};
  const total = data.total || {};

  const cartId = String(pick(data.cart_id, data.id, ''));
  const phone = normalizePhone(
    pick(customer.mobile, customer.phone, data.mobile),
    pick(customer.mobile_code, customer.country_code),
    defaultCountryCode
  );

  const name = String(pick(customer.first_name, customer.name, '')).trim();

  return {
    cart_id: cartId,
    phone,
    name,
    total: String(pick(total.amount, data.total_amount, '')),
    currency: String(pick(total.currency, data.currency, '')),
    checkout_url: String(pick(data.checkout_url, data.url, '')),
    created_at: Date.now(),
  };
}

function extractOrderPhone(payload, defaultCountryCode) {
  const data = (payload && payload.data) || {};
  const customer = data.customer || {};
  return normalizePhone(
    pick(customer.mobile, customer.phone),
    pick(customer.mobile_code, customer.country_code),
    defaultCountryCode
  );
}

module.exports = { verifySignature, extractCart, extractOrderPhone };
