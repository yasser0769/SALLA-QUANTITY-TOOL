const TOKEN_ENDPOINT = 'https://apilisting.fragrancex.com/token';
const PLACE_BULK_ORDER_ENDPOINT = 'https://apiordering.fragrancex.com/order/PlaceBulkOrder/';
const INTERNATIONAL_STANDARD_SHIPPING = 3;
const MAX_ORDERS_PER_BATCH = 100;

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

function normalizeOrderItem(item, orderIndex) {
  const itemId = String(item?.itemId ?? item?.sku ?? '').replace(/[^\d]/g, '').trim();
  const quantity = Number.parseInt(item?.quantity, 10);
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

  return {
    ShippingAddress: {
      FirstName: requiredString(order.shippingAddress.firstName, `orders[${index}].shippingAddress.firstName`, 80),
      LastName: requiredString(order.shippingAddress.lastName, `orders[${index}].shippingAddress.lastName`, 80),
      Address1: requiredString(order.shippingAddress.address1, `orders[${index}].shippingAddress.address1`, 160),
      Address2: optionalString(order.shippingAddress.address2, 160),
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
  return {
    Orders: orders.map(normalizeOrder),
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

function normalizeBulkOrderResult(payload, requestedOrders) {
  const result = payload?.BulkOrderResult ?? payload?.bulkOrderResult ?? payload;
  const orderResults = Array.isArray(result?.OrderResults)
    ? result.OrderResults
    : Array.isArray(result?.orderResults) ? result.orderResults : [];
  return {
    bulkOrderId: String(result?.BulkOrderId ?? result?.bulkOrderId ?? ''),
    bulkOrderTotalUSD: Number(result?.BulkOrderTotal ?? result?.bulkOrderTotal ?? 0) || 0,
    results: requestedOrders.map((order, index) => {
      const row = orderResults[index] || {};
      const resultCode = Number(row.ResultCode ?? row.resultCode ?? 0);
      return {
        referenceId: order.ReferenceId,
        orderId: String(row.OrderId ?? row.orderId ?? ''),
        resultCode,
        status: resultCode === 1 ? 'success' : resultCode === 2 ? 'warning' : 'failed',
        message: String(row.Message ?? row.message ?? ''),
        grandTotalUSD: Number(row.GrandTotal ?? row.grandTotal ?? 0) || 0,
        subTotalUSD: Number(row.SubTotal ?? row.subTotal ?? 0) || 0,
        shippingChargeUSD: Number(row.ShippingCharge ?? row.shippingCharge ?? 0) || 0
      };
    })
  };
}

async function placeBulkOrder(bulkOrder, token) {
  const upstream = await fetch(PLACE_BULK_ORDER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(bulkOrder)
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

  let bulkOrder;
  try {
    bulkOrder = buildBulkOrder(payload?.orders);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  try {
    const token = await fragrancexToken();
    const upstreamResult = await placeBulkOrder(bulkOrder, token);
    const normalized = normalizeBulkOrderResult(upstreamResult, bulkOrder.Orders);
    return sendJson(response, 200, { ok: true, ...normalized });
  } catch (error) {
    return sendJson(response, error.statusCode || 502, {
      error: error.message || 'FragranceX order request failed'
    });
  }
}

module.exports = handler;
module.exports.buildBulkOrder = buildBulkOrder;
module.exports.normalizeBulkOrderResult = normalizeBulkOrderResult;
module.exports.INTERNATIONAL_STANDARD_SHIPPING = INTERNATIONAL_STANDARD_SHIPPING;
