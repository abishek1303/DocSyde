import { ZodError } from "zod";
import { getContextualDocumentation } from "@/features/documentation/publication-operations";

export async function GET(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin" });
  const origin = request.headers.get("origin");
  const allowed = process.env.DOCSYDE_HOST_ORIGIN;
  // One explicit local browser origin. No credentialed requests or wildcard CORS.
  if (origin) {
    if (!allowed || origin !== allowed) return Response.json({ error: "Host origin is not allowed." }, { status: 403, headers });
    headers.set("Access-Control-Allow-Origin", allowed);
  }
  const query = new URL(request.url).searchParams;
  try {
    const result = await getContextualDocumentation({ owner: query.get("owner"), repo: query.get("repo"), route: query.get("route") });
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: "Contextual documentation is unavailable." }, { status: error instanceof ZodError ? 400 : 503, headers });
  }
}
