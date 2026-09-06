const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function retiredResponse(): Response {
  return new Response(JSON.stringify({ error: "authenticated_server_boundary_required" }), {
    status: 410,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve((request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // This function formerly proxied stock/audit/SAP/settings/REM reads using a
  // server credential without authenticating the browser caller. It is retained
  // only as a deterministic fail-closed tombstone while clients migrate fully to
  // authenticated Convex server actions. It must never read Supabase or secrets.
  return retiredResponse();
});
