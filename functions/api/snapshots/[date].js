// Cloudflare Pages Function: /api/snapshots/:date
//
// GET    → fetch one snapshot by date (YYYY-MM-DD)
// DELETE → remove one snapshot by date (rare; provided for cleanup tooling)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

function checkAuth(request, env) {
  const expected = env.SHYFTPROD_API_TOKEN;
  if (!expected) return false;
  const got = request.headers.get("Authorization") || "";
  return got === `Bearer ${expected}`;
}

export async function onRequestGet({ env, request, params }) {
  if (!checkAuth(request, env)) return unauthorized();

  const date = params.date;
  if (!DATE_RE.test(date)) return new Response("Invalid date", { status: 400 });

  const data = await env.SHYFTPROD_HISTORY.get(`history-${date}`);
  if (!data) return new Response("Not Found", { status: 404 });

  return new Response(data, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestDelete({ env, request, params }) {
  if (!checkAuth(request, env)) return unauthorized();

  const date = params.date;
  if (!DATE_RE.test(date)) return new Response("Invalid date", { status: 400 });

  await env.SHYFTPROD_HISTORY.delete(`history-${date}`);
  return new Response(JSON.stringify({ ok: true, date }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
