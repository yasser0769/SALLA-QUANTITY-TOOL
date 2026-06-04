const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const ALLOWED_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
const ALLOWED_OPERATIONS = new Set(['translate', 'review', 'health']);

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
      if (body.length > 2_000_000) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function parseJsonFromModel(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  if (!raw) throw new Error('DeepSeek returned empty JSON content');
  return JSON.parse(raw);
}

module.exports = async function handler(request, response) {
  if (request.method === 'GET') {
    return sendJson(response, 200, {
      ok: true,
      deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      accessTokenConfigured: Boolean(process.env.TRANSLATION_ACCESS_TOKEN)
    });
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const accessToken = process.env.TRANSLATION_ACCESS_TOKEN;

  if (!apiKey) {
    return sendJson(response, 500, { error: 'DEEPSEEK_API_KEY is not configured in Vercel' });
  }

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

  const operation = String(payload.operation || '');
  const model = String(payload.model || 'deepseek-v4-flash');
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  if (!ALLOWED_OPERATIONS.has(operation)) {
    return sendJson(response, 400, { error: 'Unsupported translation operation' });
  }
  if (!ALLOWED_MODELS.has(model)) {
    return sendJson(response, 400, { error: 'Unsupported DeepSeek model' });
  }
  if (operation !== 'health' && !messages.length) {
    return sendJson(response, 400, { error: 'Messages are required' });
  }

  try {
    const requestMessages = operation === 'health'
      ? [
          { role: 'system', content: 'Return JSON only. Example JSON output: {"ok":true}' },
          { role: 'user', content: 'Return {"ok":true} as JSON.' }
        ]
      : messages;
    const upstream = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        stream: false,
        max_tokens: operation === 'translate' ? 4096 : 1024,
        temperature: operation === 'translate' ? 0.1 : 0,
        messages: requestMessages
      })
    });

    if (!upstream.ok) {
      return sendJson(response, upstream.status, { error: await upstream.text() });
    }

    const data = await upstream.json();
    const parsed = parseJsonFromModel(data.choices?.[0]?.message?.content || '');
    if (operation === 'health') {
      return sendJson(response, 200, {
        ok: parsed.ok === true,
        deepseekConfigured: true,
        accessTokenConfigured: Boolean(accessToken)
      });
    }
    return sendJson(response, 200, parsed);
  } catch (error) {
    return sendJson(response, 500, { error: error.message || 'Translation request failed' });
  }
};
