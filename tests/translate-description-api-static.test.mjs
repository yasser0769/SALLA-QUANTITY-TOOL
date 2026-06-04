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
has(/thinking\s*:\s*\{\s*type\s*:\s*['"]disabled['"]\s*\}/, 'API route must disable DeepSeek thinking mode for reliable JSON output');
has(/stream\s*:\s*false/, 'API route must request non-streaming DeepSeek responses');
has(/max_tokens/, 'API route must set max_tokens to avoid truncated JSON responses');
has(/translate/, 'API route must support translation requests');
has(/review/, 'API route must support review requests');
has(/health/, 'API route must support health/preflight requests');
has(/request\.method\s*===\s*['"]GET['"]/, 'API route must expose a safe GET diagnostics response');
has(/accessToken\s*&&\s*providedToken\s*!==\s*accessToken/, 'API route must require the access token only when the env token is configured');
has(/401/, 'API route must reject invalid access tokens when protection is configured');
notHas(/sk-[A-Za-z0-9_-]{8,}/, 'API route must not contain a hard-coded secret key');
