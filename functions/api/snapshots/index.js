// Cloudflare Pages Function: /api/snapshots
//
// GET  → list all snapshot dates ([{ date, savedAt, stats }])
// POST → upsert a snapshot ({ date, payload }), keyed by date
//
// Storage: Cloudflare KV namespace bound as `SHYFTPROD_HISTORY`.
// Auth:    Bearer token in the `Authorization` header. Token comes from
//          the `SHYFTPROD_API_TOKEN` env var (server-side only — do NOT
//          prefix with VITE_ because that would bundle it into client JS).
//          The CLIENT separately knows the token via `VITE_SHYFTPROD_API_TOKEN`
//          which is fine for this internal tool. For stronger security,
//          put the Pages project behind Cloudflare Access — the auth
//          check below is then defense-in-depth.
//
// KV layout:
//   key  = `history-${YYYY-MM-DD}`
//   meta = { savedAt: ms, stats: {...} } — for fast listing without fetching value

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

function badRequest(msg) {
  return new Response(msg || "Bad Request", { status: 400 });
}

function checkAuth(request, env) {
  const expected = env.SHYFTPROD_API_TOKEN;
  if (!expected) return false; // server misconfiguration — fail closed
  const got = request.headers.get("Authorization") || "";
  return got === `Bearer ${expected}`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet({ env, request }) {
  if (!checkAuth(request, env)) return unauthorized();

  const list = await env.SHYFTPROD_HISTORY.list({ prefix: "history-" });
  // Use the metadata we wrote at PUT time so we don't need a roundtrip per key.
  const entries = list.keys.map(k => ({
    date: k.name.replace(/^history-/, ""),
    savedAt: k.metadata?.savedAt ?? null,
    stats: k.metadata?.stats ?? null,
  })).sort((a, b) => b.date.localeCompare(a.date));

  return jsonResponse({ count: entries.length, entries });
}

export async function onRequestPost({ env, request }) {
  if (!checkAuth(request, env)) return unauthorized();

  let body;
  try { body = await request.json(); }
  catch { return badRequest("Invalid JSON"); }

  const { date, payload } = body || {};
  if (!date || !DATE_RE.test(date)) return badRequest("Missing or invalid date (expected YYYY-MM-DD)");
  if (!payload || typeof payload !== "object") return badRequest("Missing payload");

  // Stash compact metadata alongside the value so list() returns it cheaply.
  // Keep metadata small — KV caps it at 1024 bytes per key.
  const metadata = {
    savedAt: payload.savedAt ?? Date.now(),
    stats: payload.stats ?? null,
  };

  await env.SHYFTPROD_HISTORY.put(
    `history-${date}`,
    JSON.stringify(payload),
    { metadata },
  );

  return jsonResponse({ ok: true, date });
}

// CORS preflight support — same-origin in production but useful if you
// ever serve the UI from a different domain (e.g. local dev hitting prod).
export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
