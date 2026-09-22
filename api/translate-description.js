const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const ALLOWED_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
const ALLOWED_BRAND_MODELS = new Set([
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash',
  'openai/gpt-5.6-luna',
  'deepseek/deepseek-v4.1-flash'
]);
const ALLOWED_OPERATIONS = new Set(['translate', 'review', 'health', 'brand_translate', 'brand_health']);

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

function stripCodeFence(text) {
  return String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function safeModelExcerpt(text) {
  return stripCodeFence(text)
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function extractJsonObject(text) {
  const raw = stripCodeFence(text);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return '';
  return raw.slice(start, end + 1);
}

function recoverTranslatedText(raw) {
  const text = stripCodeFence(raw);
  const translatedMatch = text.match(/^\s*\{\s*"translated"\s*:\s*"([\s\S]*)"\s*\}\s*$/);
  const candidate = translatedMatch ? translatedMatch[1] : text;
  const cleaned = candidate
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .trim();
  if (!cleaned || /^(Here is|Here's|I will translate|سوف أترجم|سأترجم)/i.test(cleaned)) return '';
  return cleaned;
}

function parseModelJsonSafely(text, operation) {
  const raw = stripCodeFence(text);
  if (!raw) throw new Error('DeepSeek returned empty JSON content');

  try {
    const parsed = JSON.parse(raw);
    return { ...parsed, fallbackUsed: false };
  } catch (firstError) {
    const extracted = extractJsonObject(raw);
    if (extracted && extracted !== raw) {
      try {
        const parsed = JSON.parse(extracted);
        return { ...parsed, fallbackUsed: true };
      } catch (secondError) {
        // Continue to operation-specific fallback below.
      }
    }

    if (operation === 'translate') {
      const translated = recoverTranslatedText(raw);
      if (translated) {
        return {
          translated,
          fallbackUsed: true,
          diagnostic: 'رد DeepSeek غير صالح JSON وتم استخدام fallback'
        };
      }
    }

    if (operation === 'review') {
      return {
        ok: false,
        cleaned: '',
        reasons: [`تعذر قراءة رد DeepSeek كـ JSON: ${safeModelExcerpt(raw)}`],
        fallbackUsed: true
      };
    }

    throw new Error(`تعذر قراءة رد DeepSeek كـ JSON: ${safeModelExcerpt(raw)}`);
  }
}

function parseBrandTranslations(text) {
  const raw = stripCodeFence(text);
  if (!raw) throw new Error('OpenRouter returned empty JSON content');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (firstError) {
    const extracted = extractJsonObject(raw);
    if (!extracted) throw new Error(`تعذر قراءة رد OpenRouter كـ JSON: ${safeModelExcerpt(raw)}`);
    try {
      parsed = JSON.parse(extracted);
    } catch (secondError) {
      throw new Error(`تعذر قراءة رد OpenRouter كـ JSON: ${safeModelExcerpt(raw)}`);
    }
  }
  const items = Array.isArray(parsed) ? parsed : (parsed.brands || parsed.results || []);
  if (!Array.isArray(items)) throw new Error('OpenRouter brand response is not an array');
  return items
    .map(item => ({
      brand: String(item?.brand || '').trim(),
      arabicName: String(item?.arabicName || item?.arabic || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(item => item.brand && item.arabicName);
}

async function translateBrandsWithOpenRouter({ model, brands }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENROUTER_API_KEY is not configured in Vercel');
    error.statusCode = 500;
    throw error;
  }
  const upstream = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.SITE_URL || 'https://salla-quantity-tool.vercel.app',
      'X-Title': 'Salla New Brands'
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      stream: false,
      temperature: 0,
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: 'You transliterate perfume and fashion brand names into their common Arabic spelling. Do not translate meanings and do not add the word عطور. Preserve every input brand exactly in the brand field. Return JSON only in this shape: {"brands":[{"brand":"English input","arabicName":"الاسم العربي"}]}.'
        },
        { role: 'user', content: JSON.stringify({ brands }) }
      ]
    })
  });
  if (!upstream.ok) {
    const error = new Error(await upstream.text());
    error.statusCode = upstream.status;
    throw error;
  }
  const data = await upstream.json();
  return parseBrandTranslations(data.choices?.[0]?.message?.content || '');
}

async function handler(request, response) {
  if (request.method === 'GET') {
    return sendJson(response, 200, {
      ok: true,
      deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      openrouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
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

  const operation = String(payload.operation || '');
  const model = String(payload.model || 'deepseek-v4-flash');
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const brands = Array.isArray(payload.brands) ? payload.brands.map(value => String(value || '').trim()).filter(Boolean) : [];

  if (!ALLOWED_OPERATIONS.has(operation)) {
    return sendJson(response, 400, { error: 'Unsupported translation operation' });
  }
  if (operation === 'brand_health') {
    return sendJson(response, 200, {
      ok: Boolean(process.env.OPENROUTER_API_KEY),
      provider: 'openrouter',
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      error: process.env.OPENROUTER_API_KEY ? undefined : 'OPENROUTER_API_KEY is not configured in Vercel'
    });
  }
  if (operation === 'brand_translate') {
    if (!ALLOWED_BRAND_MODELS.has(model)) {
      return sendJson(response, 400, { error: 'Unsupported OpenRouter brand model' });
    }
    if (!brands.length) {
      return sendJson(response, 400, { error: 'Brands are required' });
    }
    if (brands.length > 50) {
      return sendJson(response, 400, { error: 'Brand batch size cannot exceed 50' });
    }
    try {
      const results = await translateBrandsWithOpenRouter({ model, brands });
      return sendJson(response, 200, { ok: true, results });
    } catch (error) {
      return sendJson(response, error.statusCode || 500, { error: error.message || 'Brand translation failed' });
    }
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return sendJson(response, 500, { error: 'DEEPSEEK_API_KEY is not configured in Vercel' });
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
        max_tokens: operation === 'translate' ? 8192 : 2048,
        temperature: operation === 'translate' ? 0.1 : 0,
        messages: requestMessages
      })
    });

    if (!upstream.ok) {
      return sendJson(response, upstream.status, { error: await upstream.text() });
    }

    const data = await upstream.json();
    const parsed = parseModelJsonSafely(data.choices?.[0]?.message?.content || '', operation);
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
}

module.exports = handler;
module.exports.parseModelJsonSafely = parseModelJsonSafely;
module.exports.parseBrandTranslations = parseBrandTranslations;
module.exports.safeModelExcerpt = safeModelExcerpt;
