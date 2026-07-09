import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const costApi = require('../api/fragrancex-costs.js');

function responseMock() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = value;
    }
  };
}

function requestMock(payload, headers = {}) {
  const request = Readable.from([JSON.stringify(payload)]);
  request.method = 'POST';
  request.headers = headers;
  return request;
}

const oldEnv = { ...process.env };
const oldFetch = global.fetch;

try {
  process.env.FRAGRANCEX_API_ID = 'test-id';
  process.env.FRAGRANCEX_API_KEY = 'test-key';
  process.env.TRANSLATION_ACCESS_TOKEN = 'shared-secret';
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';
  process.env.USD_TO_SAR_RATE = '3.75';

  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url) === 'https://redis.example') {
      const command = JSON.parse(options.body);
      if (command[0] === 'GET') {
        return { ok: true, json: async () => ({ result: null }) };
      }
      if (command[0] === 'SET') {
        return { ok: true, json: async () => ({ result: 'OK' }) };
      }
    }

    if (String(url) === 'https://apilisting.fragrancex.com/token') {
      assert.equal(options.method, 'POST');
      assert.match(String(options.body), /grant_type=apiAccessKey/);
      return { ok: true, json: async () => ({ access_token: 'bearer-token', token_type: 'bearer', expires_in: 3600 }) };
    }

    assert.equal(options.headers.Authorization, 'Bearer bearer-token');
    if (String(url) === 'https://apilisting.fragrancex.com/product/list/') {
      return {
        ok: true,
        json: async () => ({
          ListProduct: [
            { ItemId: '111111', WholesalePriceUSD: 10 },
            { ItemId: '222222', WholesalePriceUSD: '5.50' }
          ]
        })
      };
    }
    if (String(url) === 'https://apiordering.fragrancex.com/order/GetFixedShipping/') {
      return { ok: true, json: async () => ({ FixedShippingCountry: [{ CountryCode: 'SA', CountryName: 'Saudi Arabia', ShippingRate: 20 }] }) };
    }
    if (String(url) === 'https://apiordering.fragrancex.com/order/GetVatCountries/') {
      return { ok: true, json: async () => ({ VatCountry: [{ CountryCode: 'SA', MinSubTotal: 0, MaxSubTotal: 0, ExceptionSubTotal: 0, VatRate: 15 }] }) };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const response = responseMock();
  await costApi(
    requestMock({
      countryCode: 'SA',
      orders: [
        { orderId: 'A100', totalValueSAR: 200, items: [{ sku: '111111', quantity: 2 }, { sku: '999999', quantity: 1 }] },
        { orderId: 'B200', totalValueSAR: 100, items: [{ sku: '222222', quantity: 2 }] }
      ]
    }, { 'x-translation-access-token': 'shared-secret' }),
    response
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.currency, 'SAR');
  assert.equal(body.usdToSarRate, 3.75);
  assert.equal(body.results[0].productCostUSD, 20);
  assert.equal(body.results[0].shippingCostUSD, 20);
  assert.equal(body.results[0].vatCostUSD, 6);
  assert.equal(body.results[0].landedCostSAR, 172.5);
  assert.equal(body.results[0].profitSAR, 27.5);
  assert.deepEqual(body.results[0].missingSkus, [{ sku: '999999', quantity: 1 }]);
  assert.equal(body.results[1].productCostUSD, 11);
  assert.equal(body.results[1].landedCostSAR, 133.69);
  assert.equal(body.results[1].profitSAR, -33.69);
  assert.equal(body.totals.missingSkuCount, 1);
  assert.ok(calls.some(call => call.url === 'https://apilisting.fragrancex.com/token'), 'token endpoint must be mocked and called');
  assert.equal(calls.filter(call => call.url === 'https://redis.example' && JSON.parse(call.options.body)[0] === 'SET').length, 3);
} finally {
  global.fetch = oldFetch;
  process.env = oldEnv;
}

const calculated = costApi.calculateOrderCosts({
  orders: [{ orderId: 'C300', totalValueSAR: 300, items: [{ sku: '333333', quantity: 3 }] }],
  catalog: { 333333: { wholesalePriceUSD: 12 } },
  shippingRows: [{ countryCode: 'SA', shippingRateUSD: 10 }],
  vatRows: [{ countryCode: 'SA', minSubTotalUSD: 0, maxSubTotalUSD: 0, exceptionSubTotalUSD: 100, vatRate: 15 }],
  usdToSarRate: 3.75
});

assert.equal(calculated.results[0].vatCostUSD, 0, 'VAT must be exempt below ExceptionSubTotal');
assert.equal(calculated.results[0].landedCostSAR, 172.5);

const fallbackShipping = costApi.calculateOrderCosts({
  orders: [
    { orderId: 'S400', totalValueSAR: 200, items: [{ sku: '555555', quantity: 1 }] },
    { orderId: 'S900', totalValueSAR: 200, items: [{ sku: '555555', quantity: 1 }, { sku: '666666', quantity: 1 }] },
    { orderId: 'S1200', totalValueSAR: 200, items: [{ sku: '777777', quantity: 3 }] },
    { orderId: 'SMISSING', totalValueSAR: 200, items: [{ sku: '888888', quantity: 1 }] }
  ],
  catalog: { 555555: { wholesalePriceUSD: 10 }, 666666: { wholesalePriceUSD: 5 }, 777777: { wholesalePriceUSD: 3 } },
  shippingRows: [{ countryCode: 'US', shippingRateUSD: 6.95 }],
  vatRows: [{ countryCode: 'SA', minSubTotalUSD: 0, maxSubTotalUSD: 0, exceptionSubTotalUSD: 0, vatRate: 0 }],
  usdToSarRate: 3.75,
  weightsBySku: { 555555: 400, 666666: 500, 777777: 400, 888888: 500 }
});

assert.equal(fallbackShipping.shippingSource, 'weight_tiers');
assert.equal(fallbackShipping.results[0].shippingEstimated, true);
assert.equal(fallbackShipping.results[0].shippingCostUSD, 14.95);
assert.equal(fallbackShipping.results[0].shippingWeightGrams, 400);
assert.equal(fallbackShipping.results[0].landedCostSAR, 93.56);
assert.equal(fallbackShipping.results[1].shippingCostUSD, 18.95);
assert.equal(fallbackShipping.results[1].shippingWeightGrams, 900);
assert.equal(fallbackShipping.results[2].shippingCostUSD, 28.95);
assert.equal(fallbackShipping.results[2].shippingWeightGrams, 1200);
assert.equal(fallbackShipping.results[3].status, 'missing_skus');
assert.equal(fallbackShipping.results[3].shippingCostUSD, 18.95);
assert.equal(fallbackShipping.results[3].landedCostSAR, 71.06);

try {
  process.env.FRAGRANCEX_API_ID = 'test-id';
  process.env.FRAGRANCEX_API_KEY = 'test-key';
  process.env.TRANSLATION_ACCESS_TOKEN = 'shared-secret';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.USD_TO_SAR_RATE = '3.75';

  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://apilisting.fragrancex.com/token') {
      return { ok: true, json: async () => ({ access_token: 'memory-token', token_type: 'bearer', expires_in: 3600 }) };
    }
    assert.match(options.headers.Authorization, /^Bearer (memory-token|bearer-token)$/);
    if (String(url) === 'https://apilisting.fragrancex.com/product/list/') {
      return { ok: true, json: async () => ({ ListProduct: [{ ItemId: '444444', WholesalePriceUSD: 8 }] }) };
    }
    if (String(url) === 'https://apiordering.fragrancex.com/order/GetFixedShipping/') {
      return { ok: true, json: async () => ({ FixedShippingCountry: [{ CountryCode: 'SA', ShippingRate: 10 }] }) };
    }
    if (String(url) === 'https://apiordering.fragrancex.com/order/GetVatCountries/') {
      return { ok: true, json: async () => ({ VatCountry: [{ CountryCode: 'SA', VatRate: 0 }] }) };
    }
    throw new Error(`Unexpected fetch URL without Redis: ${url}`);
  };

  const response = responseMock();
  await costApi(
    requestMock({
      countryCode: 'SA',
      orders: [{ orderId: 'D400', totalValueSAR: 100, items: [{ sku: '444444', quantity: 1 }] }]
    }, { 'x-translation-access-token': 'shared-secret' }),
    response
  );
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.cache.mode, 'memory', 'cost API must fall back to in-memory cache when Upstash is not configured');
  assert.equal(body.results[0].landedCostSAR, 67.5);
  assert.ok(!calls.some(call => call.url === 'https://redis.example'), 'no Redis call should be attempted without Upstash env');
} finally {
  global.fetch = oldFetch;
  process.env = oldEnv;
}
