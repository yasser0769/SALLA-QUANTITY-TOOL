import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseModelJsonSafely } = require('../api/translate-description.js');

assert.equal(typeof parseModelJsonSafely, 'function', 'parser must be exported for unit tests');

{
  const result = parseModelJsonSafely('{"translated":"وصف عربي جميل"}', 'translate');
  assert.equal(result.translated, 'وصف عربي جميل');
  assert.equal(result.fallbackUsed, false);
}

{
  const result = parseModelJsonSafely('```json\n{"ok":true,"cleaned":"وصف نظيف","reasons":[]}\n```', 'review');
  assert.equal(result.ok, true);
  assert.equal(result.cleaned, 'وصف نظيف');
  assert.deepEqual(result.reasons, []);
}

{
  const result = parseModelJsonSafely('{"translated":"عطر \"جميل\" وثابت"}', 'translate');
  assert.equal(result.translated, 'عطر "جميل" وثابت');
  assert.equal(result.fallbackUsed, true);
}

{
  const result = parseModelJsonSafely('مراجعة غير صالحة وليست JSON', 'review');
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /تعذر قراءة رد DeepSeek/);
  assert.equal(result.fallbackUsed, true);
}
