const MAX_BODY_BYTES = 200_000;
const SHARE_TTL_SECONDS = 90 * 24 * 60 * 60;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function validEnvelope(value) {
  return value &&
    value.format === "ath-envelope" &&
    typeof value.houseId === "string" &&
    typeof value.houseName === "string" &&
    typeof value.kind === "string" &&
    typeof value.iv === "string" &&
    typeof value.data === "string" &&
    !("inviteSecret" in value);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "ask-the-house-share" });
    }

    if (request.method === "POST" && url.pathname === "/share") {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > MAX_BODY_BYTES) return json({ error: "Share is too large." }, 413);

      let envelope;
      try {
        envelope = await request.json();
      } catch {
        return json({ error: "Invalid JSON." }, 400);
      }

      if (!validEnvelope(envelope)) {
        return json({ error: "Invalid encrypted share package." }, 400);
      }

      const serialized = JSON.stringify(envelope);
      if (new TextEncoder().encode(serialized).byteLength > MAX_BODY_BYTES) {
        return json({ error: "Share is too large." }, 413);
      }

      const id = randomId();
      await env.SHARES.put(`share:${id}`, serialized, {
        expirationTtl: SHARE_TTL_SECONDS
      });

      return json({ id, expiresInDays: 90 }, 201);
    }

    if (request.method === "GET" && url.pathname.startsWith("/share/")) {
      const id = url.pathname.slice("/share/".length);
      if (!/^[A-Za-z0-9_-]{20,30}$/.test(id)) {
        return json({ error: "Invalid share ID." }, 400);
      }

      const value = await env.SHARES.get(`share:${id}`);
      if (!value) return json({ error: "Share not found or expired." }, 404);

      return new Response(value, {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() }
      });
    }

    return json({ error: "Not found." }, 404);
  }
};
