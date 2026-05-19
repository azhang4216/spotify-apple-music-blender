const MAX_APPLE_TOKEN_TTL_SECONDS = 15_777_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = cors(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/health") {
      return json({ ok: true }, 200, corsHeaders);
    }

    if (url.pathname !== "/apple-music-token") {
      return json({ error: "Not found" }, 404, corsHeaders);
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const ttl = clampTtl(env.APPLE_TOKEN_TTL_SECONDS);
      const developerToken = await generateAppleDeveloperToken(env, now, ttl);

      return json(
        {
          developerToken,
          expiresAt: new Date((now + ttl) * 1000).toISOString(),
          storefrontId: env.APPLE_STOREFRONT_ID || "us",
        },
        200,
        {
          ...corsHeaders,
          "Cache-Control": "public, max-age=300",
        },
      );
    } catch (error) {
      return json({ error: error.message || "Token generation failed" }, 500, corsHeaders);
    }
  },
};

async function generateAppleDeveloperToken(env, now, ttl) {
  const teamId = required(env.APPLE_TEAM_ID, "APPLE_TEAM_ID");
  const keyId = required(env.APPLE_KEY_ID, "APPLE_KEY_ID");
  const privateKey = normalizePrivateKey(required(env.APPLE_MEDIA_SERVICES_PRIVATE_KEY, "APPLE_MEDIA_SERVICES_PRIVATE_KEY"));

  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + ttl,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await signEs256(signingInput, privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

async function signEs256(signingInput, pem) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
}

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin",
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function clampTtl(value) {
  const parsed = Number(value || 3600);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3600;
  return Math.min(Math.floor(parsed), MAX_APPLE_TOKEN_TTL_SECONDS);
}

function required(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function normalizePrivateKey(value) {
  const withNewlines = String(value).replace(/\\n/g, "\n").trim();
  if (withNewlines.includes("BEGIN PRIVATE KEY")) return withNewlines;

  return [
    "-----BEGIN PRIVATE KEY-----",
    withNewlines.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") || "",
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function base64UrlJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
