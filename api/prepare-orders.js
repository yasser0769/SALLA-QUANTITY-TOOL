const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

const ALLOWED_MODELS = {
  openrouter: new Set([
    'anthropic/claude-sonnet-4',
    'google/gemini-2.5-flash',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-r1'
  ]),
  deepseek: new Set([
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'deepseek-chat',
    'deepseek-reasoner'
  ])
};

const SYSTEM_PROMPT = `You are a Saudi address and name translator. You will receive order data in JSON format. For each order:
1. If the customer name is in Arabic, transliterate it to English, phonetically, not by meaning. If already in English, keep it.
2. Split the name into first and last name. If only one name, use it for both.
3. From the address string, extract:
   - Neighborhood name (حي), translate it to English.
   - Street name (شارع), translate it to English.
   - Short address code (العنوان المختصر), keep as-is, for example GNMA6281.
   - Zip code (الرمز البريدي), extract the number.
4. Determine the Saudi region/province for the given city.

Return ONLY a JSON array with one object per order in this exact format:
[
  {
    "orderId": "...",
    "firstName": "...",
    "lastName": "...",
    "address": "... District, ... Street",
    "address2": "XXXX0000",
    "city": "...",
    "state": "...",
    "zip": "00000"
  }
]

Important rules:
- For address, format as: "[Neighborhood English] District, [Street English] Street".
- If neighborhood or street is missing, omit that part.
- City should be in English.
- State must be EXACTLY one of these values only:
  "Riyadh", "Mecca", "Madinah", "Eastern Province", "Al Qassim", "Asir", "Tabuk", "Hail", "Northern Borders", "Jazan", "Najran", "Al Bahah", "Al Jouf".
- Return ONLY the JSON array, no markdown, no notes, and no extra keys.`;

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

function stripCodeFence(text) {
  return String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function safeModelExcerpt(text) {
  return stripCodeFence(text)
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function parseJsonArray(text) {
  const raw = stripCodeFence(text);
  if (!raw) throw new Error('AI provider returned empty content');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('AI response is not a JSON array');
    return parsed;
  } catch (firstError) {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch (secondError) {
        // Fall through to the safer error below.
      }
    }
    throw new Error(`تعذر قراءة رد المزود كـ JSON: ${safeModelExcerpt(raw)}`);
  }
}

function providerConfig(provider) {
  if (provider === 'deepseek') {
    return {
      endpoint: DEEPSEEK_ENDPOINT,
      apiKey: process.env.DEEPSEEK_API_KEY,
      missingMessage: 'DEEPSEEK_API_KEY is not configured in Vercel',
      extraHeaders: {}
    };
  }
  return {
    endpoint: OPENROUTER_ENDPOINT,
    apiKey: process.env.OPENROUTER_API_KEY,
    missingMessage: 'OPENROUTER_API_KEY is not configured in Vercel',
    extraHeaders: {
      'HTTP-Referer': process.env.SITE_URL || 'https://salla-quantity-tool.vercel.app',
      'X-Title': 'Salla Prepare Orders'
    }
  };
}

function normalizeProvider(value) {
  return value === 'deepseek' ? 'deepseek' : 'openrouter';
}

async function callProvider({ provider, model, orders }) {
  const config = providerConfig(provider);
  if (!config.apiKey) {
    const error = new Error(config.missingMessage);
    error.statusCode = 500;
    throw error;
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(orders, null, 2) }
  ];
  const body = {
    model,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: 4096
  };
  if (provider === 'deepseek') {
    body.thinking = { type: 'disabled' };
  }

  const upstream = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.extraHeaders
    },
    body: JSON.stringify(body)
  });

  if (!upstream.ok) {
    const error = new Error(await upstream.text());
    error.statusCode = upstream.status;
    throw error;
  }

  const data = await upstream.json();
  return parseJsonArray(data.choices?.[0]?.message?.content || '');
}

async function handler(request, response) {
  if (request.method === 'GET') {
    return sendJson(response, 200, {
      ok: true,
      defaultProvider: 'openrouter',
      openrouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
      deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      accessTokenConfigured: Boolean(process.env.TRANSLATION_ACCESS_TOKEN)
    });
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
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

  const operation = String(payload.operation || 'translate');
  const provider = normalizeProvider(payload.provider);
  const model = String(payload.model || (provider === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'deepseek-v4-flash'));
  const orders = Array.isArray(payload.orders) ? payload.orders : [];

  if (operation === 'health') {
    const config = providerConfig(provider);
    return sendJson(response, 200, {
      ok: Boolean(config.apiKey),
      provider,
      configured: Boolean(config.apiKey),
      accessTokenConfigured: Boolean(accessToken)
    });
  }
  if (operation !== 'translate') {
    return sendJson(response, 400, { error: 'Unsupported operation' });
  }
  if (!ALLOWED_MODELS[provider].has(model)) {
    return sendJson(response, 400, { error: `Unsupported ${provider} model` });
  }
  if (!orders.length) {
    return sendJson(response, 400, { error: 'Orders are required' });
  }
  if (orders.length > 100) {
    return sendJson(response, 400, { error: 'Batch size cannot exceed 100 orders' });
  }

  try {
    const translated = await callProvider({ provider, model, orders });
    return sendJson(response, 200, { ok: true, results: translated });
  } catch (error) {
    return sendJson(response, error.statusCode || 500, {
      error: error.message || 'Order preparation request failed'
    });
  }
}

module.exports = handler;
module.exports.parseJsonArray = parseJsonArray;
module.exports.safeModelExcerpt = safeModelExcerpt;
