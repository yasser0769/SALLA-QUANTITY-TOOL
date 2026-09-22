import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/translate-description.js');

function invoke(payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = {
      method: 'POST',
      headers: {},
      on(event, callback) {
        if (event === 'data') queueMicrotask(() => callback(body));
        if (event === 'end') queueMicrotask(callback);
        return this;
      },
      destroy() {}
    };
    const headers = new Map();
    const response = {
      statusCode: 200,
      setHeader(name, value) { headers.set(name, value); },
      end(value = '') {
        resolve({ status: this.statusCode, headers, json: value ? JSON.parse(value) : null });
      }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const previousKey = process.env.OPENROUTER_API_KEY;
const previousFetch = globalThis.fetch;
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

try {
  const health = await invoke({ operation: 'brand_health', model: 'openai/gpt-4o-mini' });
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.provider, 'openrouter');

  let upstreamRequest;
  globalThis.fetch = async (url, init) => {
    upstreamRequest = { url, init };
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: '{"brands":[{"brand":"Nine West","arabicName":"ناين ويست"}]}' } }]
        };
      }
    };
  };

  const translated = await invoke({
    operation: 'brand_translate',
    model: 'openai/gpt-5.6-luna',
    brands: ['Nine West']
  });
  assert.equal(translated.status, 200);
  assert.deepEqual(translated.json.results, [{ brand: 'Nine West', arabicName: 'ناين ويست' }]);
  assert.equal(upstreamRequest.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.match(upstreamRequest.init.headers.Authorization, /^Bearer test-openrouter-key$/);

  const deepSeekFlash = await invoke({
    operation: 'brand_translate',
    model: 'deepseek/deepseek-v4.1-flash',
    brands: ['Nine West']
  });
  assert.equal(deepSeekFlash.status, 200);
} finally {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
}
