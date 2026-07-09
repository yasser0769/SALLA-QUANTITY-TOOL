const fs = require('node:fs');
const path = require('node:path');

const TOKEN_ENDPOINT = 'https://apilisting.fragrancex.com/token';
const PRODUCT_LIST_ENDPOINT = 'https://apilisting.fragrancex.com/product/list/';
const FIXED_SHIPPING_ENDPOINT = 'https://apiordering.fragrancex.com/order/GetFixedShipping/';
const VAT_COUNTRIES_ENDPOINT = 'https://apiordering.fragrancex.com/order/GetVatCountries/';
const DEFAULT_COUNTRY_CODE = 'SA';
const DEFAULT_USD_TO_SAR_RATE = 3.75;
const DEFAULT_MISSING_WEIGHT_GRAMS = 500;
const SA_WEIGHT_SHIPPING_TIERS = [
  { maxGrams: 400, rateUSD: 14.95 },
  { maxGrams: 900, rateUSD: 18.95 },
  { maxGrams: 1200, rateUSD: 28.95 },
  { maxGrams: 1800, rateUSD: 38.95 },
  { maxGrams: 2000, rateUSD: 71.3511 },
  { maxGrams: 2500, rateUSD: 82.5324 },
  { maxGrams: 3000, rateUSD: 91.1161 },
  { maxGrams: 5000, rateUSD: 104.6819 }
];
const HEAVY_SHIPPING_EXTRA_PER_500G_USD = 4;
const CACHE_TTL_SECONDS = 60 * 60 * 30;

let inMemoryToken = null;
const memoryCache = new Map();
let cachedWeights = null;

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
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cleanSku(value) {
  return String(value ?? '').replace(/[^\d]/g, '').trim();
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
  const amount = Number.parseFloat(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function configuredUsdToSarRate() {
  const value = Number.parseFloat(process.env.USD_TO_SAR_RATE || '');
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_USD_TO_SAR_RATE;
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redisCommand(command) {
  const config = redisConfig();
  if (!config) return null;
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  if (!response.ok) {
    const error = new Error(`تعذر الاتصال بكاش Upstash Redis (${response.status})`);
    error.statusCode = 500;
    throw error;
  }
  return response.json();
}

async function readCache(key) {
  const data = await redisCommand(['GET', key]);
  if (!data) {
    const cached = memoryCache.get(key);
    if (!cached || cached.expiresAt <= Date.now()) return null;
    return cached.value;
  }
  if (!data.result) return null;
  return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
}

async function writeCache(key, value) {
  const data = await redisCommand(['SET', key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS]);
  if (!data) {
    memoryCache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000
    });
  }
}

function extractArray(payload, preferredKeys) {
  if (Array.isArray(payload)) return payload;
  for (const key of preferredKeys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  const firstArray = Object.values(payload || {}).find(Array.isArray);
  if (firstArray) return firstArray;
  throw new Error('رد FragranceX لا يحتوي قائمة صالحة');
}

async function fragrancexToken() {
  if (inMemoryToken && inMemoryToken.expiresAt > Date.now() + 60_000) {
    return inMemoryToken.accessToken;
  }
  const apiId = process.env.FRAGRANCEX_API_ID;
  const apiKey = process.env.FRAGRANCEX_API_KEY;
  if (!apiId || !apiKey) {
    const error = new Error('FRAGRANCEX_API_ID أو FRAGRANCEX_API_KEY غير مضافة في إعدادات Vercel');
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'apiAccessKey',
      apiAccessId: apiId,
      apiAccessKey: apiKey
    })
  });
  if (!response.ok) {
    const error = new Error(`تعذر الحصول على توكن FragranceX (${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  const data = await response.json();
  if (!data.access_token) throw new Error('FragranceX لم يرجع access_token صالح');
  inMemoryToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000
  };
  return inMemoryToken.accessToken;
}

async function fragrancexGet(url, token) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const error = new Error(`خطأ من FragranceX (${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

function normalizeProductCatalog(products) {
  const bySku = {};
  for (const product of products) {
    const sku = cleanSku(product.ItemId ?? product.ItemID ?? product.ItemNo ?? product.ItemNumber ?? product.itemId);
    if (!sku || bySku[sku]) continue;
    const wholesalePriceUSD = numberValue(product.WholesalePriceUSD ?? product.wholesalePriceUSD ?? product.WholesalePrice ?? product.Cost);
    if (wholesalePriceUSD > 0) {
      bySku[sku] = { wholesalePriceUSD: roundMoney(wholesalePriceUSD) };
    }
  }
  return bySku;
}

function normalizeShippingCountries(rows) {
  return rows.map(row => ({
    countryCode: String(row.CountryCode ?? row.countryCode ?? '').trim().toUpperCase(),
    countryName: String(row.CountryName ?? row.countryName ?? '').trim(),
    shippingRateUSD: roundMoney(numberValue(row.ShippingRate ?? row.shippingRate))
  })).filter(row => row.countryCode || row.countryName);
}

function normalizeVatCountries(rows) {
  return rows.map(row => ({
    countryCode: String(row.CountryCode ?? row.countryCode ?? '').trim().toUpperCase(),
    countryName: String(row.CountryName ?? row.countryName ?? '').trim(),
    minSubTotalUSD: numberValue(row.MinSubTotal ?? row.minSubTotal),
    maxSubTotalUSD: numberValue(row.MaxSubTotal ?? row.maxSubTotal),
    exceptionSubTotalUSD: numberValue(row.ExceptionSubTotal ?? row.exceptionSubTotal),
    vatRate: numberValue(row.VatRate ?? row.VATRate ?? row.vatRate)
  })).filter(row => row.countryCode || row.countryName);
}

function loadSkuWeights() {
  if (cachedWeights) return cachedWeights;
  const filePath = path.join(process.cwd(), 'data', 'fragrancex-weights.json');
  try {
    cachedWeights = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    cachedWeights = {};
  }
  return cachedWeights;
}

async function cachedDataset(cacheName, loader) {
  const key = `fragrancex:${cacheName}:${todayKey()}`;
  const cached = await readCache(key);
  if (cached) return { value: cached, cacheKey: key, cacheHit: true };
  const value = await loader();
  await writeCache(key, value);
  return { value, cacheKey: key, cacheHit: false };
}

async function loadCostData() {
  let tokenPromise = null;
  const getToken = () => {
    tokenPromise ||= fragrancexToken();
    return tokenPromise;
  };
  const catalog = await cachedDataset('catalog', async () => {
    const token = await getToken();
    const data = await fragrancexGet(PRODUCT_LIST_ENDPOINT, token);
    return normalizeProductCatalog(extractArray(data, ['ListProduct', 'Products', 'Product', 'products', 'items']));
  });
  const shipping = await cachedDataset('shipping', async () => {
    const token = await getToken();
    const data = await fragrancexGet(FIXED_SHIPPING_ENDPOINT, token);
    return normalizeShippingCountries(extractArray(data, ['FixedShippingCountry', 'FixedShippingCountries', 'fixedShippingCountries']));
  });
  const vat = await cachedDataset('vat', async () => {
    const token = await getToken();
    const data = await fragrancexGet(VAT_COUNTRIES_ENDPOINT, token);
    return normalizeVatCountries(extractArray(data, ['VatCountry', 'VatCountries', 'vatCountries']));
  });
  return { catalog, shipping, vat };
}

function findCountryRow(rows, countryCode) {
  const code = String(countryCode || DEFAULT_COUNTRY_CODE).trim().toUpperCase();
  return rows.find(row => row.countryCode === code) || rows.find(row => /saudi/i.test(row.countryName));
}

function vatAmountUSD(vatRule, subtotalUSD) {
  if (!vatRule || subtotalUSD <= 0) return 0;
  if (vatRule.exceptionSubTotalUSD > 0 && subtotalUSD < vatRule.exceptionSubTotalUSD) return 0;
  if (vatRule.minSubTotalUSD > 0 && subtotalUSD < vatRule.minSubTotalUSD) return 0;
  if (vatRule.maxSubTotalUSD > 0 && subtotalUSD > vatRule.maxSubTotalUSD) return 0;
  const rate = vatRule.vatRate > 1 ? vatRule.vatRate / 100 : vatRule.vatRate;
  return roundMoney(subtotalUSD * Math.max(0, rate));
}

function normalizeOrderItems(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const sku = cleanSku(item.sku);
    const quantity = Math.max(0, Number.parseInt(item.quantity, 10) || 0);
    if (!sku || quantity <= 0) continue;
    map.set(sku, (map.get(sku) || 0) + quantity);
  }
  return [...map.entries()].map(([sku, quantity]) => ({ sku, quantity }));
}

function estimateSaudiShippingUSD(items, weightsBySku = loadSkuWeights()) {
  let totalGrams = 0;
  let matchedQuantity = 0;
  const missingWeightSkus = [];
  for (const item of items) {
    matchedQuantity += item.quantity;
    if (Object.prototype.hasOwnProperty.call(weightsBySku, item.sku)) {
      const weight = Math.max(0, numberValue(weightsBySku[item.sku]));
      totalGrams += weight * item.quantity;
    } else {
      totalGrams += DEFAULT_MISSING_WEIGHT_GRAMS * item.quantity;
      missingWeightSkus.push({ sku: item.sku, quantity: item.quantity });
    }
  }
  totalGrams = Math.max(0, Math.round(totalGrams));
  if (matchedQuantity <= 0) {
    return { shippingCostUSD: 0, totalGrams: 0, missingWeightSkus, shippingSource: 'weight_tiers' };
  }
  const chargeableGrams = Math.max(1, totalGrams);
  const tier = SA_WEIGHT_SHIPPING_TIERS.find(row => chargeableGrams <= row.maxGrams);
  if (tier) {
    return {
      shippingCostUSD: roundMoney(tier.rateUSD),
      totalGrams,
      missingWeightSkus,
      shippingSource: 'weight_tiers'
    };
  }
  const lastTier = SA_WEIGHT_SHIPPING_TIERS[SA_WEIGHT_SHIPPING_TIERS.length - 1];
  const extraBlocks = Math.ceil((totalGrams - lastTier.maxGrams) / 500);
  return {
    shippingCostUSD: roundMoney(lastTier.rateUSD + extraBlocks * HEAVY_SHIPPING_EXTRA_PER_500G_USD),
    totalGrams,
    missingWeightSkus,
    shippingSource: 'weight_tiers_heavy_extension'
  };
}

function calculateOrderCosts({ orders, catalog, shippingRows, vatRows, countryCode = DEFAULT_COUNTRY_CODE, usdToSarRate = DEFAULT_USD_TO_SAR_RATE, weightsBySku = loadSkuWeights() }) {
  const shippingRule = findCountryRow(shippingRows, countryCode);
  const vatRule = findCountryRow(vatRows, countryCode);
  const shippingRateUSD = shippingRule?.shippingRateUSD || 0;
  const useEstimatedShipping = shippingRateUSD <= 0;

  const results = orders.map(order => {
    const items = normalizeOrderItems(order.items);
    const missingSkus = [];
    let productCostUSD = 0;
    for (const item of items) {
      const product = catalog[item.sku];
      if (!product) {
        missingSkus.push({ sku: item.sku, quantity: item.quantity });
        continue;
      }
      productCostUSD += item.quantity * product.wholesalePriceUSD;
    }
    productCostUSD = roundMoney(productCostUSD);
    const shippingEstimate = estimateSaudiShippingUSD(items, weightsBySku);
    const hasShippableItems = items.length > 0;
    const shippingCostUSD = hasShippableItems
      ? roundMoney(useEstimatedShipping ? shippingEstimate.shippingCostUSD : shippingRateUSD)
      : 0;
    const vatCostUSD = vatAmountUSD(vatRule, productCostUSD + shippingCostUSD);
    const landedCostUSD = roundMoney(productCostUSD + shippingCostUSD + vatCostUSD);
    const landedCostSAR = roundMoney(landedCostUSD * usdToSarRate);
    const orderValueSAR = roundMoney(numberValue(order.totalValueSAR ?? order.totalValue));
    return {
      orderId: String(order.orderId || ''),
      items,
      missingSkus,
      missingWeightSkus: shippingEstimate.missingWeightSkus,
      productCostUSD,
      shippingCostUSD,
      shippingEstimated: hasShippableItems && useEstimatedShipping,
      shippingSource: useEstimatedShipping ? shippingEstimate.shippingSource : 'fixed_country',
      shippingWeightGrams: useEstimatedShipping ? shippingEstimate.totalGrams : 0,
      vatCostUSD,
      landedCostUSD,
      productCostSAR: roundMoney(productCostUSD * usdToSarRate),
      shippingCostSAR: roundMoney(shippingCostUSD * usdToSarRate),
      vatCostSAR: roundMoney(vatCostUSD * usdToSarRate),
      landedCostSAR,
      profitSAR: roundMoney(orderValueSAR - landedCostSAR),
      status: missingSkus.length ? 'missing_skus' : productCostUSD > 0 ? 'ok' : 'no_matched_items'
    };
  });

  return {
    currency: 'SAR',
    sourceCurrency: 'USD',
    usdToSarRate,
    shippingRateUSD,
    shippingSource: useEstimatedShipping ? 'weight_tiers' : 'fixed_country',
    shippingTiers: SA_WEIGHT_SHIPPING_TIERS,
    vatRate: vatRule?.vatRate || 0,
    results,
    totals: results.reduce((totals, row) => {
      totals.productCostSAR = roundMoney(totals.productCostSAR + row.productCostSAR);
      totals.shippingCostSAR = roundMoney(totals.shippingCostSAR + row.shippingCostSAR);
      totals.vatCostSAR = roundMoney(totals.vatCostSAR + row.vatCostSAR);
      totals.landedCostSAR = roundMoney(totals.landedCostSAR + row.landedCostSAR);
      totals.profitSAR = roundMoney(totals.profitSAR + row.profitSAR);
      totals.missingSkuCount += row.missingSkus.length;
      totals.missingWeightCount += row.missingWeightSkus.length;
      return totals;
    }, { productCostSAR: 0, shippingCostSAR: 0, vatCostSAR: 0, landedCostSAR: 0, profitSAR: 0, missingSkuCount: 0, missingWeightCount: 0 })
  };
}

async function handler(request, response) {
  if (request.method === 'GET') {
    return sendJson(response, 200, {
      ok: true,
      fragrancexConfigured: Boolean(process.env.FRAGRANCEX_API_ID && process.env.FRAGRANCEX_API_KEY),
      redisConfigured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      cacheMode: process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'upstash' : 'memory',
      accessTokenConfigured: Boolean(process.env.TRANSLATION_ACCESS_TOKEN),
      skuWeightsConfigured: Object.keys(loadSkuWeights()).length,
      usdToSarRate: configuredUsdToSarRate()
    });
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  const accessToken = process.env.TRANSLATION_ACCESS_TOKEN;
  const providedToken = request.headers['x-translation-access-token'];
  if (accessToken && providedToken !== accessToken) {
    return sendJson(response, 401, { error: 'Invalid translation access token' });
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch (error) {
    return sendJson(response, 400, { error: 'Invalid JSON request body' });
  }

  const orders = Array.isArray(payload.orders) ? payload.orders : [];
  if (!orders.length) return sendJson(response, 400, { error: 'Orders are required' });
  if (orders.length > 500) return sendJson(response, 400, { error: 'Cannot price more than 500 orders at once' });

  try {
    const costData = await loadCostData();
    const calculated = calculateOrderCosts({
      orders,
      catalog: costData.catalog.value,
      shippingRows: costData.shipping.value,
      vatRows: costData.vat.value,
      countryCode: payload.countryCode || DEFAULT_COUNTRY_CODE,
      usdToSarRate: configuredUsdToSarRate()
    });
    return sendJson(response, 200, {
      ok: true,
      ...calculated,
      cache: {
        catalog: costData.catalog.cacheHit,
        shipping: costData.shipping.cacheHit,
        vat: costData.vat.cacheHit,
        mode: process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'upstash' : 'memory'
      }
    });
  } catch (error) {
    return sendJson(response, error.statusCode || 500, {
      error: error.message || 'FragranceX cost request failed'
    });
  }
}

module.exports = handler;
module.exports.calculateOrderCosts = calculateOrderCosts;
module.exports.normalizeProductCatalog = normalizeProductCatalog;
module.exports.normalizeShippingCountries = normalizeShippingCountries;
module.exports.normalizeVatCountries = normalizeVatCountries;
module.exports.vatAmountUSD = vatAmountUSD;
module.exports.estimateSaudiShippingUSD = estimateSaudiShippingUSD;
