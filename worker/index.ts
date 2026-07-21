import handler from "vinext/server/app-router-entry";
import prepareOrders from "./legacy/prepare-orders.cjs";
import translateDescription from "./legacy/translate-description.cjs";
import fragrancexCosts from "./legacy/fragrancex-costs.cjs";
import { handleSallaWebhook } from "./salla-webhook.mjs";

interface Env {
  ASSETS: Fetcher;
  [key: string]: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type LegacyHandler = (request: unknown, response: unknown) => Promise<unknown> | unknown;

function exposeEnvironment(env: Env | undefined) {
  if (!env) return;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
}

async function invokeLegacyApi(legacyHandler: LegacyHandler, request: Request): Promise<Response> {
  const body = await request.text();
  const headers = Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value]));
  const requestLike = {
    method: request.method,
    headers,
    destroyed: false,
    on(event: string, callback: (value?: string | Error) => void) {
      if (event === "data" && body) queueMicrotask(() => callback(body));
      if (event === "end") queueMicrotask(() => callback());
      return this;
    },
    destroy() { this.destroyed = true; },
  };

  let settled = false;
  let resolveResponse!: (response: Response) => void;
  const responsePromise = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  const responseHeaders = new Headers();
  const responseLike = {
    statusCode: 200,
    setHeader(name: string, value: string) { responseHeaders.set(name, value); },
    end(payload = "") {
      if (settled) return;
      settled = true;
      resolveResponse(new Response(payload, { status: this.statusCode, headers: responseHeaders }));
    },
  };

  try {
    await legacyHandler(requestLike, responseLike);
    if (!settled) responseLike.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected API error";
    return Response.json({ error: message }, { status: 500 });
  }
  return responsePromise;
}

const apiHandlers = new Map<string, LegacyHandler>([
  ["/api/prepare-orders", prepareOrders],
  ["/api/translate-description", translateDescription],
  ["/api/fragrancex-costs", fragrancexCosts],
]);

async function serveTool(request: Request, env: Env | undefined): Promise<Response> {
  const toolUrl = new URL("/tool.html", request.url);
  if (!env?.ASSETS) return Response.redirect(toolUrl, 302);

  const assetResponse = await env.ASSETS.fetch(new Request(toolUrl, request));
  if (!assetResponse.ok) return assetResponse;
  const origin = new URL(request.url).origin;
  const socialMetadata = `
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_SA">
<meta property="og:title" content="أداة تحديث أسعار وكميات سلة">
<meta property="og:description" content="ملفات جاهزة للرفع خلال دقائق">
<meta property="og:image" content="${origin}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="أداة تحديث أسعار وكميات سلة">
<meta name="twitter:description" content="ملفات جاهزة للرفع خلال دقائق">
<meta name="twitter:image" content="${origin}/og.png">`;
  const html = (await assetResponse.text()).replace("</head>", `${socialMetadata}\n</head>`);
  const headers = new Headers(assetResponse.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, { status: assetResponse.status, headers });
}

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    exposeEnvironment(env);
    const url = new URL(request.url);
    if (url.pathname === "/api/webhooks/salla") {
      return handleSallaWebhook(request, {
        SALLA_WEBHOOK_SECRET:
          typeof env?.SALLA_WEBHOOK_SECRET === "string"
            ? env.SALLA_WEBHOOK_SECRET
            : process.env.SALLA_WEBHOOK_SECRET,
      });
    }
    const apiHandler = apiHandlers.get(url.pathname);
    if (apiHandler) return invokeLegacyApi(apiHandler, request);

    if (url.pathname === "/") return serveTool(request, env);

    if (url.pathname === "/og.png" || url.pathname.endsWith(".html") || url.pathname.startsWith("/assets/")) {
      if (env?.ASSETS) return env.ASSETS.fetch(request);
    }
    return handler.fetch(request, env ?? {}, ctx);
  },
};

export default worker;
