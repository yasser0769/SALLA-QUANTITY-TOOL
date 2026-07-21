const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 1_000_000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function hexToBytes(value) {
  const normalized = String(value || "").trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return null;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function createSallaSignature(rawBody, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifySallaSignature(rawBody, signatureHeader, secret) {
  const received = hexToBytes(signatureHeader);
  if (!received || !secret) return false;
  const expected = hexToBytes(await createSallaSignature(rawBody, secret));
  if (!expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ received[index];
  }
  return difference === 0;
}

export function summarizeSallaEvent(payload) {
  const data = payload?.data ?? {};
  const merchant = payload?.merchant ?? data?.merchant ?? {};
  return {
    event: String(payload?.event ?? payload?.type ?? "unknown"),
    merchantId: String(merchant?.id ?? payload?.merchant_id ?? ""),
    objectId: String(data?.id ?? payload?.id ?? ""),
  };
}

export async function handleSallaWebhook(request, env = {}, logger = console) {
  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      endpoint: "salla-webhook",
      signatureConfigured: Boolean(env.SALLA_WEBHOOK_SECRET),
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...JSON_HEADERS, Allow: "GET, POST" },
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Webhook payload is too large" }, 413);
  }

  const secret = String(env.SALLA_WEBHOOK_SECRET || "");
  if (!secret) {
    return jsonResponse({ error: "Webhook signature is not configured" }, 503);
  }

  const signature = request.headers.get("x-salla-signature") || "";
  if (!(await verifySallaSignature(rawBody, signature, secret))) {
    return jsonResponse({ error: "Invalid Salla webhook signature" }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const summary = summarizeSallaEvent(payload);
  logger.info("Salla webhook received", summary);
  return jsonResponse({
    ok: true,
    received: true,
    event: summary.event,
  });
}
