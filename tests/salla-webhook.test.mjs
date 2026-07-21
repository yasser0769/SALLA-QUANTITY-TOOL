import assert from "node:assert/strict";
import test from "node:test";
import {
  createSallaSignature,
  handleSallaWebhook,
  summarizeSallaEvent,
  verifySallaSignature,
} from "../worker/salla-webhook.mjs";

const secret = "test-salla-webhook-secret";
const body = JSON.stringify({
  event: "order.created",
  merchant: { id: 12345 },
  data: { id: 98765, customer: { name: "Private customer" } },
});

test("validates Salla HMAC-SHA256 signatures", async () => {
  const signature = await createSallaSignature(body, secret);
  assert.equal(signature.length, 64);
  assert.equal(await verifySallaSignature(body, signature, secret), true);
  assert.equal(await verifySallaSignature(`${body} `, signature, secret), false);
});

test("accepts a signed webhook and logs only its summary", async () => {
  const signature = await createSallaSignature(body, secret);
  const messages = [];
  const response = await handleSallaWebhook(
    new Request("https://example.com/api/webhooks/salla", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Salla-Signature": signature,
      },
      body,
    }),
    { SALLA_WEBHOOK_SECRET: secret },
    { info: (...args) => messages.push(args) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    received: true,
    event: "order.created",
  });
  assert.deepEqual(messages, [["Salla webhook received", {
    event: "order.created",
    merchantId: "12345",
    objectId: "98765",
  }]]);
});

test("rejects requests with invalid signatures", async () => {
  const response = await handleSallaWebhook(
    new Request("https://example.com/api/webhooks/salla", {
      method: "POST",
      headers: { "X-Salla-Signature": "0".repeat(64) },
      body,
    }),
    { SALLA_WEBHOOK_SECRET: secret },
  );
  assert.equal(response.status, 401);
});

test("reports endpoint health without exposing secrets", async () => {
  const response = await handleSallaWebhook(
    new Request("https://example.com/api/webhooks/salla"),
    { SALLA_WEBHOOK_SECRET: secret },
  );
  assert.deepEqual(await response.json(), {
    ok: true,
    endpoint: "salla-webhook",
    signatureConfigured: true,
  });
});

test("summarizes events without customer payload data", () => {
  assert.deepEqual(summarizeSallaEvent(JSON.parse(body)), {
    event: "order.created",
    merchantId: "12345",
    objectId: "98765",
  });
});
