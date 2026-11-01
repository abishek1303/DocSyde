import { currentDocsydeIdentity } from "@/integrations/reliability/docsyde-identity";

/** Only the explicitly launched reliability server exposes an authenticated identity. */
export async function GET(request: Request) {
  try {
    return Response.json(await currentDocsydeIdentity(request.headers.get("x-docsyde-reliability-token")), { headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 404 }); }
}
