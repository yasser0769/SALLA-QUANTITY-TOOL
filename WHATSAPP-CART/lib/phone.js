function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

// Turns Salla's mobile fields into a bare international number (e.g. 966512345678).
// Returns '' when the input cannot be trusted.
function normalizePhone(mobile, mobileCode, defaultCountryCode) {
  const country = digitsOnly(mobileCode) || digitsOnly(defaultCountryCode) || '966';
  let n = digitsOnly(mobile);
  if (!n) return '';

  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith(country)) return n;
  if (n.startsWith('0')) n = n.slice(1);
  if (n.startsWith(country)) return n;

  const combined = `${country}${n}`;
  if (combined.length < 10 || combined.length > 15) return '';
  return combined;
}

function toJid(phone) {
  return `${digitsOnly(phone)}@s.whatsapp.net`;
}

function fromJid(jid) {
  return digitsOnly(String(jid || '').split('@')[0].split(':')[0]);
}

module.exports = { normalizePhone, toJid, fromJid, digitsOnly };
