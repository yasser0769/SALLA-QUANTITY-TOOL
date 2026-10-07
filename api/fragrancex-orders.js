const TOKEN_ENDPOINT = 'https://apilisting.fragrancex.com/token';
const PLACE_BULK_ORDER_ENDPOINT = 'https://apiordering.fragrancex.com/order/PlaceBulkOrder/';
const INTERNATIONAL_STANDARD_SHIPPING = 3;
const MAX_ORDERS_PER_BATCH = 100;
const MAX_ADDRESS_LINE_LENGTH = 60;
const { createHash } = require('node:crypto');
const KNOWN_ORDERS = require('../data/fragrancex-reconciled-orders.json');
const TRACKING_ENDPOINT = 'https://apitracking.fragrancex.com/tracking/gettrackinginfo/';
const PRODUCT_ENDPOINT = 'https://apilisting.fragrancex.com/product/get/';
const LEDGER_PREFIX = 'salla-quantity:fragrancex:orders:v1:';

let inMemoryToken = null;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 500_000) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function requiredString(value, field, maxLength = 160) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > maxLength) throw new Error(`${field} is too long`);
  return text;
}

function optionalString(value, maxLength = 160) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function shippingAddressLines(address1, address2, index) {
  const first = String(address1 ?? '').trim().replace(/\s+/g, ' ');
  const second = String(address2 ?? '').trim().replace(/\s+/g, ' ');
  const field = `orders[${index}].shippingAddress`;
  if (!first) throw new Error(`${field}.address1 is required`);
  if (second.length > 160) {
    throw new Error(`${field}.address2 exceeds 160 characters; keep only the national address`);
  }
  if (first.length <= MAX_ADDRESS_LINE_LENGTH) return { first, second };

  const parts = first.split(/[,،]/).map(part => part.trim()).filter(Boolean);
  const compact = part => part.replace(/\s+(?:District|Neighborhood|Street|Road)$/i, '').trim();
  const candidates = parts.length > 1
    ? second
      ? [`${parts[0]}, ${parts[1]}`, `${compact(parts[0])}, ${compact(parts[1])}`, compact(parts[1]), compact(parts[0])]
      : [parts.map(compact).join(', ')]
    : [compact(first)];
  const concise = candidates.find(candidate => candidate && candidate.length <= MAX_ADDRESS_LINE_LENGTH);
  if (!concise) throw new Error(`${field}.address1 cannot be shortened to 60 characters; review it manually`);
  return { first: concise, second };
}

function normalizeOrderItem(item, orderIndex) {
  const itemId = String(item?.itemId ?? item?.sku ?? '').trim();
  const quantity = Number(item?.quantity);
  if (!/^\d{6}$/.test(itemId)) {
    throw new Error(`orders[${orderIndex}].items contains an invalid FragranceX ItemId`);
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error(`orders[${orderIndex}].items contains an invalid quantity`);
  }
  return { ItemId: itemId, Quantity: quantity };
}

function normalizeOrder(order, index) {
  const referenceId = requiredString(order?.referenceId, `orders[${index}].referenceId`, 80);
  const country = requiredString(order?.shippingAddress?.country, `orders[${index}].shippingAddress.country`, 2).toUpperCase();
  if (country !== 'SA') throw new Error(`orders[${index}].shippingAddress.country must be SA`);

  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) throw new Error(`orders[${index}].items is required`);
  const address = shippingAddressLines(order.shippingAddress.address1, order.shippingAddress.address2, index);

  return {
    ShippingAddress: {
      FirstName: requiredString(order.shippingAddress.firstName, `orders[${index}].shippingAddress.firstName`, 80),
      LastName: requiredString(order.shippingAddress.lastName, `orders[${index}].shippingAddress.lastName`, 80),
      Address1: address.first,
      Address2: address.second,
      City: requiredString(order.shippingAddress.city, `orders[${index}].shippingAddress.city`, 80),
      State: requiredString(order.shippingAddress.state, `orders[${index}].shippingAddress.state`, 80),
      Zipcode: requiredString(order.shippingAddress.zipcode, `orders[${index}].shippingAddress.zipcode`, 20),
      Country: country,
      Phone: requiredString(order.shippingAddress.phone, `orders[${index}].shippingAddress.phone`, 30)
    },
    ShippingMethod: INTERNATIONAL_STANDARD_SHIPPING,
    OrderItems: items.map(item => normalizeOrderItem(item, index)),
    ReferenceId: referenceId,
    IsDropship: true,
    IsGiftWrapped: Boolean(order.isGiftWrapped),
    GiftWrapMessage: order.isGiftWrapped ? optionalString(order.giftWrapMessage, 240) : ''
  };
}

function buildBulkOrder(orders) {
  if (!Array.isArray(orders) || !orders.length) throw new Error('Orders are required');
  if (orders.length > MAX_ORDERS_PER_BATCH) throw new Error(`Cannot place more than ${MAX_ORDERS_PER_BATCH} orders at once`);
  const normalized = orders.map(normalizeOrder);
  if (new Set(normalized.map(order => order.ReferenceId)).size !== normalized.length) {
    throw new Error('Duplicate order reference IDs are not allowed');
  }
  return {
    Orders: normalized,
    BillingInfoSpecified: false,
    PaymentMethod: 'cc'
  };
}

async function fragrancexToken() {
  if (inMemoryToken && inMemoryToken.expiresAt > Date.now() + 60_000) return inMemoryToken.accessToken;
  const apiId = process.env.FRAGRANCEX_API_ID;
  const apiKey = process.env.FRAGRANCEX_API_KEY;
  if (!apiId || !apiKey) {
    const error = new Error('FRAGRANCEX_API_ID or FRAGRANCEX_API_KEY is not configured');
    error.statusCode = 503;
    throw error;
  }

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'apiAccessKey',
      apiAccessId: apiId,
      apiAccessKey: apiKey
    })
  });
  if (!tokenResponse.ok) {
    const error = new Error(`FragranceX authentication failed (${tokenResponse.status})`);
    error.statusCode = tokenResponse.status;
    throw error;
  }
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error('FragranceX did not return a valid access token');
  inMemoryToken = {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + Math.max(60, Number(tokenData.expires_in) || 3600) * 1000
  };
  return inMemoryToken.accessToken;
}

function normalizeBulkOrderResult(payload, requestedOrders, verifiedReferences = {}) {
  const result = payload?.BulkOrderResult ?? payload?.bulkOrderResult ?? payload;
  const orderResults = Array.isArray(result?.OrderResults)
    ? result.OrderResults
    : Array.isArray(result?.orderResults) ? result.orderResults : [];
  return {
    bulkOrderId: String(result?.BulkOrderId ?? result?.bulkOrderId ?? ''),
    bulkOrderTotalUSD: Number(result?.BulkOrderTotal ?? result?.bulkOrderTotal ?? 0) || 0,
    results: requestedOrders.map(order => {
      const matches = orderResults.filter(row => {
        const id = String(row.OrderId ?? row.orderId ?? '');
        const reference = row.ReferenceId ?? row.referenceId ?? verifiedReferences[id];
        return String(reference ?? '') === order.ReferenceId ||
          (reference == null && requestedOrders.length === 1 && orderResults.length === 1);
      });
      const row = matches.length === 1 ? matches[0] : {};
      const code = row.ResultCode ?? row.resultCode;
      const resultCode = /^(0|1|2)$/.test(String(code ?? '')) ? Number(code) : null;
      const orderId = String(row.OrderId ?? row.orderId ?? '');
      const repeatedOrderId = orderId && orderResults.filter(item => String(item.OrderId ?? item.orderId ?? '') === orderId).length > 1;
      const status = matches.length !== 1 || repeatedOrderId ? 'unknown'
        : resultCode === 0 && !orderId ? 'failed'
        : resultCode === 1 && orderId ? 'success'
        : resultCode === 2 && orderId ? 'warning' : 'unknown';
      return {
        referenceId: order.ReferenceId,
        orderId,
        resultCode,
        status,
        message: status === 'unknown' ? 'نتيجة غير مؤكدة؛ راجع ربط المورد قبل إعادة الإرسال.' : String(row.Message ?? row.message ?? ''),
        grandTotalUSD: Number(row.GrandTotal ?? row.grandTotal ?? 0) || 0,
        subTotalUSD: Number(row.SubTotal ?? row.subTotal ?? 0) || 0,
        shippingChargeUSD: Number(row.ShippingCharge ?? row.shippingCharge ?? 0) || 0
      };
    })
  };
}

function ledgerConfigured() {
  return Boolean(ledgerConfig().url && ledgerConfig().token);
}

function ledgerConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  };
}

async function ledgerCommand(command) {
  if (!ledgerConfigured()) {
    const error = new Error('سجل منع التكرار غير مهيأ؛ التنفيذ متوقف لحماية الطلبات.');
    error.statusCode = 503;
    throw error;
  }
  const config = ledgerConfig();
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error('تعذر الوصول إلى سجل منع التكرار؛ لا تعد إرسال الطلب.');
  const data = await response.json();
  if (data.error) throw new Error('تعذر حفظ سجل منع التكرار؛ التنفيذ متوقف.');
  return data.result;
}

function orderKey(referenceId) { return `${LEDGER_PREFIX}ref:${referenceId}`; }
function batchKey(attemptId) { return `${LEDGER_PREFIX}batch:${attemptId}`; }

// Claim every reference atomically, with no expiry. A timeout must never permit a second purchase.
const CLAIM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'attempt_exists' end
for i=2,#KEYS do
  local old=redis.call('GET',KEYS[i])
  if old and cjson.decode(old).status ~= 'failed' then return KEYS[i] end
end
for i=1,#KEYS do redis.call('SET',KEYS[i],ARGV[i]) end
return 'OK'`;

const SAVE_SCRIPT = `
for i=2,#KEYS do
  local old=redis.call('GET',KEYS[i])
  if not old or cjson.decode(old).attemptId ~= ARGV[1] then return 'owner_mismatch' end
end
for i=1,#KEYS do redis.call('SET',KEYS[i],ARGV[i+1]) end
return 'OK'`;

async function claimOrders(orders, attemptId) {
  const records = orders.map(order => ({
    referenceId: order.ReferenceId, attemptId, status: 'pending', resultCode: null,
    fingerprint: createHash('sha256').update(JSON.stringify(order)).digest('hex'),
    message: 'جارٍ التنفيذ أو بانتظار التحقق؛ يمنع إعادة الإرسال.', updatedAt: new Date().toISOString()
  }));
  const batch = { attemptId, references: records.map(row => row.referenceId), status: 'pending' };
  const keys = [batchKey(attemptId), ...records.map(row => orderKey(row.referenceId))];
  const result = await ledgerCommand(['EVAL', CLAIM_SCRIPT, keys.length, ...keys, JSON.stringify(batch), ...records.map(row => JSON.stringify(row))]);
  if (result !== 'OK') {
    const error = new Error('هذا الطلب أُرسل سابقًا أو تنفيذه غير مؤكد؛ حدّث ربط المورد قبل إعادة الإرسال.');
    error.statusCode = 409;
    throw error;
  }
  return { batch, records, keys };
}

async function saveResults(claim, results, batchUpdates = {}) {
  const records = claim.records.map(record => ({ ...record, ...results.find(row => row.referenceId === record.referenceId), updatedAt: new Date().toISOString() }));
  const batch = { ...claim.batch, ...batchUpdates };
  const result = await ledgerCommand(['EVAL', SAVE_SCRIPT, claim.keys.length, ...claim.keys, batch.attemptId, JSON.stringify(batch), ...records.map(row => JSON.stringify(row))]);
  if (result !== 'OK') throw new Error('تعذر تأكيد حفظ النتيجة؛ يمنع إعادة الإرسال حتى مراجعة المورد.');
  claim.batch = batch;
  claim.records = records;
  return records;
}

let lastSupplierRead = 0;
async function supplierRead(url, token) {
  const delay = Math.max(0, lastSupplierRead + 350 - Date.now());
  lastSupplierRead = Date.now() + delay;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`تعذر التحقق من FragranceX (${response.status})؛ لن يتم إرسال الطلب.`);
  return response.json();
}

function trackingReference(payload) {
  const row = payload?.TrackingInfo ?? payload?.trackingInfo ?? payload;
  return String(row?.ReferenceId ?? row?.referenceId ?? '');
}

async function verifyResponseReferences(payload, orders, token) {
  const result = payload?.BulkOrderResult ?? payload?.bulkOrderResult ?? payload;
  const rows = result?.OrderResults ?? result?.orderResults ?? [];
  const verified = {};
  if (orders.length === 1 || !Array.isArray(rows)) return verified;
  for (const row of rows) {
    const orderId = String(row.OrderId ?? row.orderId ?? '');
    if (!orderId || row.ReferenceId != null || row.referenceId != null) continue;
    try {
      const tracking = await supplierRead(`${TRACKING_ENDPOINT}${encodeURIComponent(orderId)}`, token);
      const reference = trackingReference(tracking);
      if (reference) verified[orderId] = reference;
    } catch { /* Persist an unknown result and reconcile later; never purchase again. */ }
  }
  return verified;
}

async function preflightOrders(orders, token) {
  for (const reference of orders.map(row => row.ReferenceId)) {
    const found = await supplierRead(`${TRACKING_ENDPOINT}${encodeURIComponent(reference)}`, token);
    if (trackingReference(found)) {
      const error = new Error(`طلب ${reference} موجود لدى المورد؛ يمنع إعادة الإرسال.`);
      error.statusCode = 409;
      error.existingReference = reference;
      throw error;
    }
  }
  const items = [...new Set(orders.flatMap(row => row.OrderItems.map(item => item.ItemId)))];
  for (const itemId of items) {
    const data = await supplierRead(`${PRODUCT_ENDPOINT}${itemId}`, token);
    const product = data?.Product ?? data?.product ?? data;
    if (String(product?.ItemId ?? product?.itemId ?? '') !== itemId || product?.Instock !== true) {
      throw new Error(`SKU ${itemId}: التوافر غير مؤكد أو المنتج غير متوفر؛ لم يتم إرسال الطلبات.`);
    }
  }
}

async function orderHistory(references, reconcile) {
  const ids = references.map(value => requiredString(value, 'referenceId', 80));
  if (!ids.length || ids.length > 25 || new Set(ids).size !== ids.length) throw new Error('أرسل من 1 إلى 25 مرجعًا مختلفًا للمطابقة.');
  const stored = await ledgerCommand(['MGET', ...ids.map(orderKey)]);
  let token;
  const results = [];
  const resolvedBatches = new Map();
  for (let index = 0; index < ids.length; index++) {
    const referenceId = ids[index];
    const known = KNOWN_ORDERS[referenceId];
    let record = known || (stored?.[index] ? JSON.parse(stored[index]) : null);
    if (reconcile && record?.attemptId && ['pending', 'unknown'].includes(record.status)) {
      const rawBatch = await ledgerCommand(['GET', batchKey(record.attemptId)]);
      const batch = rawBatch ? JSON.parse(rawBatch) : null;
      if (batch?.upstreamResult) {
        let normalized = resolvedBatches.get(record.attemptId);
        if (!normalized) {
          token ||= await fragrancexToken();
          const orders = batch.references.map(ReferenceId => ({ ReferenceId }));
          const verified = await verifyResponseReferences(batch.upstreamResult, orders, token);
          normalized = normalizeBulkOrderResult(batch.upstreamResult, orders, verified);
          resolvedBatches.set(record.attemptId, normalized);
        }
        const match = normalized.results.find(row => row.referenceId === referenceId);
        if (match && match.status !== 'unknown') {
          record = { ...record, ...match };
          // Only the owning attempt may update a record; do not overwrite a newer retry.
          const saved = await ledgerCommand(['EVAL', `local old=redis.call('GET',KEYS[1]); if old and cjson.decode(old).attemptId == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2]); return 'OK' end; return 'changed'`, 1, orderKey(referenceId), record.attemptId, JSON.stringify(record)]);
          if (saved !== 'OK') throw new Error('تغير سجل الطلب أثناء المطابقة؛ أعد تحديث الربط.');
        }
      } else {
        token ||= await fragrancexToken();
        const tracking = await supplierRead(`${TRACKING_ENDPOINT}${encodeURIComponent(referenceId)}`, token);
        if (trackingReference(tracking) === referenceId) {
          record = { ...record, status: 'review_required', message: 'وجد المرجع لدى المورد؛ يمنع إعادة الإرسال ويحتاج مراجعة تفاصيل التنفيذ.' };
          await ledgerCommand(['EVAL', `local old=redis.call('GET',KEYS[1]); if old and cjson.decode(old).attemptId == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2]); return 'OK' end; return 'changed'`, 1, orderKey(referenceId), record.attemptId, JSON.stringify(record)]);
        }
      }
    }
    results.push(record || { referenceId, status: 'not_sent', orderId: '', resultCode: null, message: '' });
  }
  return results;
}

async function placeBulkOrder(bulkOrder, token) {
  const upstream = await fetch(PLACE_BULK_ORDER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(bulkOrder),
    signal: AbortSignal.timeout(25_000)
  });
  const responseText = await upstream.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { Message: responseText.slice(0, 500) };
  }
  if (!upstream.ok) {
    const error = new Error(data?.Message || data?.message || `FragranceX order request failed (${upstream.status})`);
    error.statusCode = upstream.status;
    throw error;
  }
  return data;
}

async function handler(request, response) {
  if (request.method === 'GET') {
    return sendJson(response, 200, {
      ok: true,
      configured: Boolean(process.env.FRAGRANCEX_API_ID && process.env.FRAGRANCEX_API_KEY),
      protected: Boolean(process.env.TRANSLATION_ACCESS_TOKEN),
      ledgerConfigured: ledgerConfigured(),
      orderingReady: ledgerConfigured() && Boolean(process.env.FRAGRANCEX_API_ID && process.env.FRAGRANCEX_API_KEY),
      shippingMethod: INTERNATIONAL_STANDARD_SHIPPING,
      paymentMethod: 'cc'
    });
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  const accessToken = process.env.TRANSLATION_ACCESS_TOKEN;
  if (!accessToken) return sendJson(response, 503, { error: 'TRANSLATION_ACCESS_TOKEN is required for order placement' });
  if (request.headers['x-translation-access-token'] !== accessToken) {
    return sendJson(response, 401, { error: 'Invalid translation access token' });
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch {
    return sendJson(response, 400, { error: 'Invalid JSON request body' });
  }

  const operation = payload?.operation || 'place';
  if (operation === 'history' || operation === 'reconcile') {
    try {
      const results = await orderHistory(Array.isArray(payload.references) ? payload.references : [], operation === 'reconcile');
      return sendJson(response, 200, { ok: true, results });
    } catch (error) { return sendJson(response, error.statusCode || 502, { error: error.message }); }
  }
  if (operation !== 'place') return sendJson(response, 400, { error: 'Unsupported operation' });
  let bulkOrder;
  try {
    bulkOrder = buildBulkOrder(payload?.orders);
    if (bulkOrder.Orders.some(order => KNOWN_ORDERS[order.ReferenceId])) {
      return sendJson(response, 409, { error: 'هذا المرجع ضمن الطلبات التي تمت مراجعتها؛ حدّث ربط المورد ولا تعد الإرسال.', results: bulkOrder.Orders.map(order => KNOWN_ORDERS[order.ReferenceId]).filter(Boolean) });
    }
    const supplierReads = bulkOrder.Orders.length + new Set(bulkOrder.Orders.flatMap(row => row.OrderItems.map(item => item.ItemId))).size;
    if (supplierReads > 30) throw new Error('قسّم التنفيذ إلى دفعات أصغر (حتى 30 فحصًا للطلبات والمنتجات).');
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  let claim;
  let dispatched = false;
  try {
    const attemptId = requiredString(payload?.attemptId, 'attemptId', 80);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(attemptId)) return sendJson(response, 400, { error: 'Invalid attemptId' });
    claim = await claimOrders(bulkOrder.Orders, attemptId);
    const token = await fragrancexToken();
    await preflightOrders(bulkOrder.Orders, token);
    dispatched = true;
    const upstreamResult = await placeBulkOrder(bulkOrder, token);
    // Save the supplier response before any subsequent network calls can fail.
    await saveResults(claim, [], { upstreamResult, status: 'received' });
    const verified = await verifyResponseReferences(upstreamResult, bulkOrder.Orders, token);
    const normalized = normalizeBulkOrderResult(upstreamResult, bulkOrder.Orders, verified);
    await saveResults(claim, normalized.results, { upstreamResult, status: 'received' });
    return sendJson(response, 200, { ok: true, ...normalized });
  } catch (error) {
    let results = [];
    if (claim) {
      results = claim.records.map(row => ({ referenceId: row.referenceId, orderId: '', resultCode: null,
        status: dispatched ? 'unknown' : error.existingReference === row.referenceId ? 'review_required' : 'failed',
        message: dispatched ? 'نتيجة الإرسال غير مؤكدة؛ يمنع إعادة الإرسال حتى مراجعة المورد.' : error.message }));
      try { await saveResults(claim, results, { status: dispatched ? 'unknown' : 'preflight_failed' }); }
      catch { /* The permanent pending claim still blocks duplicate purchases. */ }
    }
    return sendJson(response, error.statusCode || 502, { error: error.message || 'FragranceX order request failed', results });
  }
}

module.exports = handler;
module.exports.buildBulkOrder = buildBulkOrder;
module.exports.normalizeBulkOrderResult = normalizeBulkOrderResult;
module.exports.INTERNATIONAL_STANDARD_SHIPPING = INTERNATIONAL_STANDARD_SHIPPING;
module.exports.CLAIM_SCRIPT = CLAIM_SCRIPT;
module.exports.SAVE_SCRIPT = SAVE_SCRIPT;
