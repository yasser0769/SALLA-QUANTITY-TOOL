import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const orderApi = require('../api/fragrancex-orders.js');

function responseMock() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; }
  };
}

function requestMock(payload, headers = {}) {
  const request = Readable.from([JSON.stringify(payload)]);
  request.method = 'POST';
  request.headers = headers;
  return request;
}

function sampleOrder(overrides = {}) {
  return {
    referenceId: 'SALLA-1001',
    shippingAddress: {
      firstName: 'Ali',
      lastName: 'Ahmed',
      address1: 'Al Thuqbah District, King Street',
      address2: 'EEDA8685',
      city: 'Al Khobar',
      state: 'Eastern Province',
      zipcode: '34623',
      country: 'SA',
      phone: '966500000000'
    },
    items: [{ itemId: '567086', quantity: 1 }],
    isGiftWrapped: false,
    giftWrapMessage: '',
    ...overrides
  };
}

const built = orderApi.buildBulkOrder([sampleOrder()]);
assert.equal(built.BillingInfoSpecified, false);
assert.equal(built.PaymentMethod, 'cc');
assert.equal(built.Orders[0].ShippingMethod, 3);
assert.equal(built.Orders[0].ReferenceId, 'SALLA-1001');
assert.equal(built.Orders[0].IsDropship, true);
assert.deepEqual(built.Orders[0].OrderItems, [{ ItemId: '567086', Quantity: 1 }]);
assert.throws(
  () => orderApi.buildBulkOrder([sampleOrder({ items: [{ itemId: 'bad-sku', quantity: 1 }] })]),
  /invalid FragranceX ItemId/
);
const oldEnv = { ...process.env };
const oldFetch = global.fetch;

try {
  process.env.FRAGRANCEX_API_ID = 'test-id';
  process.env.FRAGRANCEX_API_KEY = 'test-key';
  process.env.TRANSLATION_ACCESS_TOKEN = 'shared-secret';

  const unauthorized = responseMock();
  await orderApi(requestMock({ orders: [sampleOrder()] }, { 'x-translation-access-token': 'wrong' }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://apilisting.fragrancex.com/token') {
      assert.equal(options.method, 'POST');
      assert.match(String(options.body), /grant_type=apiAccessKey/);
      return {
        ok: true,
        json: async () => ({ access_token: 'bearer-token', token_type: 'bearer', expires_in: 3600 })
      };
    }
    if (String(url) === 'https://apiordering.fragrancex.com/order/PlaceBulkOrder/') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer bearer-token');
      assert.equal(options.headers['Content-Type'], 'application/json');
      const payload = JSON.parse(options.body);
      assert.equal(payload.Orders[0].ReferenceId, 'SALLA-1001');
      assert.equal(payload.Orders[0].ShippingMethod, 3);
      assert.equal(payload.PaymentMethod, 'cc');
      return {
        ok: true,
        text: async () => JSON.stringify({
          BulkOrderResult: {
            BulkOrderId: 'BULK-9',
            BulkOrderTotal: 42.5,
            OrderResults: [{
              OrderId: 'FX-500',
              GrandTotal: 42.5,
              SubTotal: 30,
              ShippingCharge: 12.5,
              ResultCode: 1,
              Message: ''
            }]
          }
        })
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const response = responseMock();
  await orderApi(
    requestMock({ orders: [sampleOrder()] }, { 'x-translation-access-token': 'shared-secret' }),
    response
  );
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.bulkOrderId, 'BULK-9');
  assert.equal(body.bulkOrderTotalUSD, 42.5);
  assert.deepEqual(body.results[0], {
    referenceId: 'SALLA-1001',
    orderId: 'FX-500',
    resultCode: 1,
    status: 'success',
    message: '',
    grandTotalUSD: 42.5,
    subTotalUSD: 30,
    shippingChargeUSD: 12.5
  });
  assert.equal(calls.length, 2);
} finally {
  global.fetch = oldFetch;
  process.env = oldEnv;
}
