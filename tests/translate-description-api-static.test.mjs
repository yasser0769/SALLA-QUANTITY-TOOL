import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiPath = 'api/translate-description.js';

assert.ok(fs.existsSync(apiPath), 'Vercel translation API route must exist');

const api = fs.readFileSync(apiPath, 'utf8');

function has(pattern, message) {
  assert.match(api, pattern, message);
}

function notHas(pattern, message) {
  assert.doesNotMatch(api, pattern, message);
}

has(/process\.env\.DEEPSEEK_API_KEY/, 'API route must read DeepSeek key from Vercel env');
has(/process\.env\.TRANSLATION_ACCESS_TOKEN/, 'API route must read access token from Vercel env');
has(/https:\/\/api\.deepseek\.com\/chat\/completions/, 'API route must call DeepSeek server-side');
has(/response_format\s*:\s*\{\s*type\s*:\s*['"]json_object['"]\s*\}/, 'API route must request JSON object responses from DeepSeek');
has(/translate/, 'API route must support translation requests');
has(/review/, 'API route must support review requests');
has(/401/, 'API route must reject missing or invalid access tokens');
notHas(/sk-[A-Za-z0-9_-]{8,}/, 'API route must not contain a hard-coded secret key');
