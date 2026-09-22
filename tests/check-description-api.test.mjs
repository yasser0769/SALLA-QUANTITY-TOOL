import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/check-description.js');

function invoke(body, token = 'test-access') {
  return new Promise((resolve, reject) => {
    const request = {
      method: 'POST',
      headers: { 'x-translation-access-token': token },
      on(event, callback) {
        if (event === 'data') queueMicrotask(() => callback(JSON.stringify(body)));
        if (event === 'end') queueMicrotask(callback);
        return this;
      },
      destroy() {}
    };
    const response = {
      statusCode: 200,
      setHeader() {},
      end(text) { resolve({ status: this.statusCode, data: JSON.parse(text) }); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test('Jev audit uses authenticated decisions endpoint and validates structured results', async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldToken = process.env.TRANSLATION_ACCESS_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.TRANSLATION_ACCESS_TOKEN = 'test-access';
  try {
    assert.equal((await invoke({ items: [{ title: 'A', description: 'B' }] }, 'wrong')).status, 401);
    let called = false;
    globalThis.fetch = async (url, init) => {
      called = true;
      assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
      assert.equal(init.headers.Authorization, 'Bearer test-key');
      const body = JSON.parse(init.body);
      assert.equal(body.model, '~typesafe/jev-latest');
      assert.deepEqual(body.state, { products: [{ title: 'عطر روز', description: 'عطر روز بنفحات ورد' }, { title: 'عطر عود', description: 'عطر فانيلا' }] });
      assert.equal(body.questions.verdict_0.type, 'choice');
      assert.match(body.questions.verdict_1.instructions, /products\[1\]/);
      return {
        ok: true,
        async json() {
          return { model: 'typesafe/jev-1.13', answers: {
            verdict_0: { type: 'choice', choice: 'match', probabilities: { match: .92, mismatch: .03, uncertain: .05 } },
            issue_0: { type: 'choice', choice: 'no_clear_issue', probabilities: {} },
            verdict_1: { type: 'choice', choice: 'mismatch', probabilities: { match: .01, mismatch: .95, uncertain: .04 } },
            issue_1: { type: 'choice', choice: 'different_product', probabilities: {} }
          }, usage: { input_tokens: 123 } };
        }
      };
    };
    const response = await invoke({ items: [{ title: 'عطر روز', description: 'عطر روز بنفحات ورد' }, { title: 'عطر عود', description: 'عطر فانيلا' }] });
    assert.equal(response.status, 200);
    assert.equal(response.data.results[0].verdict, 'match');
    assert.equal(response.data.results[0].probabilities.match, .92);
    assert.equal(response.data.results[1].verdict, 'mismatch');
    assert.equal(response.data.inputTokens, 123);
    assert.equal(called, true);
    globalThis.fetch = async () => ({ ok: true, async json() { return { answers: {} }; } });
    assert.equal((await invoke({ items: [{ title: 'عطر روز', description: 'وصف' }] })).status, 502);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldToken === undefined) delete process.env.TRANSLATION_ACCESS_TOKEN;
    else process.env.TRANSLATION_ACCESS_TOKEN = oldToken;
  }
});
