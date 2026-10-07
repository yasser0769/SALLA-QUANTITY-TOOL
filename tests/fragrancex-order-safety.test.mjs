import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const api = require('../api/fragrancex-orders.js');
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const records = new Map();
let purchases = 0;
let inStock = true;
let upstreamMode = 'success';
let supplierResponse;
let failResultWrites = false;
let trackingByOrder = {};

const order = referenceId => ({ referenceId,
  shippingAddress: { firstName: 'Ali', lastName: 'Ahmed', address1: 'Al Yasmin', address2: 'RAYB7802', city: 'Riyadh', state: 'Riyadh', zipcode: '13322', country: 'SA', phone: '966500000000' },
  items: [{ itemId: '542940', quantity: 2 }] });

async function invoke(payload) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = 'POST'; req.headers = { 'x-translation-access-token': 'shared-secret' };
  const res = { statusCode: 0, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await api(req, res);
  return res;
}

function redisResult(command) {
  if (command[0] === 'MGET') return command.slice(1).map(key => records.get(key) || null);
  if (command[0] === 'GET') return records.get(command[1]) || null;
  assert.equal(command[0], 'EVAL');
  const [, script, count] = command;
  const keys = command.slice(3, 3 + count);
  const args = command.slice(3 + count);
  if (script === api.CLAIM_SCRIPT) {
    if (records.has(keys[0])) return 'attempt_exists';
    for (const key of keys.slice(1)) if (records.has(key) && JSON.parse(records.get(key)).status !== 'failed') return key;
    keys.forEach((key, index) => records.set(key, args[index]));
  } else if (script === api.SAVE_SCRIPT) {
    if (failResultWrites) throw new Error('simulated storage outage after purchase');
    for (const key of keys.slice(1)) if (JSON.parse(records.get(key)).attemptId !== args[0]) return 'owner_mismatch';
    keys.forEach((key, index) => records.set(key, args[index + 1]));
  } else {
    if (JSON.parse(records.get(keys[0])).attemptId !== args[0]) return 'changed';
    records.set(keys[0], args[1]);
  }
  return 'OK';
}

process.env.TRANSLATION_ACCESS_TOKEN = 'shared-secret';
process.env.FRAGRANCEX_API_ID = 'test-id';
process.env.FRAGRANCEX_API_KEY = 'test-key';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

global.fetch = async (url, options = {}) => {
  url = String(url);
  if (url === 'https://redis.example') return { ok: true, json: async () => ({ result: redisResult(JSON.parse(options.body)) }) };
  if (url.endsWith('/token')) return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) };
  if (url.includes('/gettrackinginfo/')) {
    const key = decodeURIComponent(url.split('/').pop());
    return trackingByOrder[key] ? { ok: true, json: async () => ({ ReferenceId: trackingByOrder[key] }) } : { ok: false, status: 404 };
  }
  if (url.includes('/product/get/')) return { ok: true, json: async () => ({ ItemId: url.split('/').pop(), Instock: inStock }) };
  if (url.includes('PlaceBulkOrder')) {
    purchases++;
    if (upstreamMode === 'timeout') throw new Error('simulated response loss after charge');
    if (upstreamMode === 'write-failure') failResultWrites = true;
    const input = JSON.parse(options.body);
    const rows = input.Orders.map(row => ({ ReferenceId: row.ReferenceId, OrderId: `FX-${row.ReferenceId}`, ResultCode: 1 }));
    return { ok: true, text: async () => JSON.stringify(supplierResponse || { BulkOrderResult: { BulkOrderId: 'B-1', OrderResults: rows } }) };
  }
  throw new Error(`Unexpected URL ${url}`);
};

test('duplicate references and malformed SKU/quantity never reach the supplier', async () => {
  assert.throws(() => api.buildBulkOrder([order('A'), order('A')]), /Duplicate/);
  for (const item of [{ itemId: 'SKU542940', quantity: 2 }, { itemId: '542940', quantity: '2x' }, { itemId: '542940', quantity: 1.5 }]) {
    assert.throws(() => api.buildBulkOrder([{ ...order('A'), items: [item] }]), /invalid/);
  }
  assert.equal(purchases, 0);
});

test('Khalid and Lamia audit prevents resubmission and survives reimport', async () => {
  for (const reference of ['292246033','292208856']) {
    const response = await invoke({ attemptId: 'incident-attempt-00001', orders: [order(reference)] });
    assert.equal(response.statusCode, 409);
  }
  const history = await invoke({ operation: 'reconcile', references: ['292246033','292208856'] });
  assert.equal(history.body.results[0].status, 'duplicate');
  assert.deepEqual(history.body.results[0].orderIds, ['75062344','75062488']);
  assert.equal(history.body.results[1].status, 'review_required');
  assert.equal(purchases, 0);
});

test('Vercel marketplace KV credentials support durable history', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.KV_REST_API_URL = 'https://redis.example';
  process.env.KV_REST_API_TOKEN = 'redis-token';
  const response = await invoke({ operation: 'history', references: ['292246033'] });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.results[0].status, 'duplicate');
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';
});

test('missing durable ledger blocks purchases', async () => {
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const response = await invoke({ attemptId: 'missing-ledger-00001', orders: [order('NO-LEDGER')] });
  assert.equal(response.statusCode, 503);
  assert.equal(purchases, 0);
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';
});

test('live out-of-stock preflight blocks a priced item before purchase', async () => {
  inStock = false;
  const response = await invoke({ attemptId: 'out-of-stock-000001', orders: [order('STOCK')] });
  assert.equal(response.body.results[0].status, 'failed');
  assert.equal(purchases, 0);
  inStock = true;
});

test('concurrent requests for the same reference purchase only once', async () => {
  const responses = await Promise.all([
    invoke({ attemptId: 'concurrent-first-001', orders: [order('CONCURRENT')] }),
    invoke({ attemptId: 'concurrent-second-01', orders: [order('CONCURRENT')] })
  ]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200,409]);
  assert.equal(purchases, 1);
  const repeat = await invoke({ attemptId: 'concurrent-third-001', orders: [order('CONCURRENT')] });
  assert.equal(repeat.statusCode, 409);
  assert.equal(purchases, 1);
});

test('response loss freezes the reference across new attempts', async () => {
  upstreamMode = 'timeout';
  const response = await invoke({ attemptId: 'timeout-attempt-0001', orders: [order('TIMEOUT')] });
  assert.equal(response.body.results[0].status, 'unknown');
  const repeat = await invoke({ attemptId: 'timeout-attempt-0002', orders: [order('TIMEOUT')] });
  assert.equal(repeat.statusCode, 409);
  assert.equal(purchases, 2);
  const history = await invoke({ operation: 'history', references: ['TIMEOUT'] });
  assert.equal(history.body.results[0].status, 'unknown');
  upstreamMode = 'success';
});

test('result persistence failure keeps the permanent claim', async () => {
  upstreamMode = 'write-failure';
  await invoke({ attemptId: 'storage-attempt-0001', orders: [order('STORAGE')] });
  failResultWrites = false; upstreamMode = 'success';
  const repeat = await invoke({ attemptId: 'storage-attempt-0002', orders: [order('STORAGE')] });
  assert.equal(repeat.statusCode, 409);
  const history = await invoke({ operation: 'history', references: ['STORAGE'] });
  assert.equal(history.body.results[0].status, 'pending');
  assert.equal(purchases, 3);
});

test('reordered and missing results never borrow another reference', () => {
  const input = [{ ReferenceId:'A' }, { ReferenceId:'B' }];
  const normalized = api.normalizeBulkOrderResult({ OrderResults: [
    { ReferenceId:'B', OrderId:'FX-B', ResultCode:1 },
    { ReferenceId:'A', OrderId:'FX-A', ResultCode:2 }
  ] }, input);
  assert.equal(normalized.results[0].orderId, 'FX-A');
  assert.equal(normalized.results[0].status, 'warning');
  assert.equal(normalized.results[1].orderId, 'FX-B');
  const noReferences = api.normalizeBulkOrderResult({ OrderResults: [{ OrderId:'FX-B', ResultCode:1 }] }, input);
  assert.ok(noReferences.results.every(row => row.status === 'unknown' && !row.orderId));
  const duplicateIds = api.normalizeBulkOrderResult({ OrderResults: input.map(row => ({ ...row, OrderId:'FX-SAME', ResultCode:1 })) }, input);
  assert.ok(duplicateIds.results.every(row => row.status === 'unknown'));
  assert.equal(api.normalizeBulkOrderResult({ OrderResults:[{ ResultCode:'', Message:'invalid' }] }, [{ ReferenceId:'A' }]).results[0].status,'unknown');
});

test('ambiguous batch reconciles by tracking reference instead of list position', async () => {
  supplierResponse = { OrderResults: [{ OrderId:'FX-REB', ResultCode:1 },{ OrderId:'FX-REA', ResultCode:1 }] };
  const response = await invoke({ attemptId: 'reconcile-attempt-001', orders: [order('REA'),order('REB')] });
  assert.ok(response.body.results.every(row => row.status === 'unknown'));
  trackingByOrder = { 'FX-REA':'REA', 'FX-REB':'REB' };
  const history = await invoke({ operation:'reconcile', references:['REA','REB'] });
  assert.equal(history.body.results[0].orderId,'FX-REA');
  assert.equal(history.body.results[1].orderId,'FX-REB');
  assert.ok(history.body.results.every(row => row.status === 'success'));
  supplierResponse = undefined; trackingByOrder = {};
});

test.after(() => { global.fetch = originalFetch; process.env = originalEnv; });
