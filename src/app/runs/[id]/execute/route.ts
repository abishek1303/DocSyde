import { executeDocumentationRun } from "@/features/documentation/run-operations";
export const maxDuration = 360;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Next can normalize request.url to localhost while the browser uses 127.0.0.1.
  // Compare the browser Origin with the actual HTTP Host, not that internal URL.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin = origin.host === request.headers.get("host") && origin.protocol === new URL(request.url).protocol;
  } catch { /* Missing or malformed origins are rejected. */ }
  if (!sameOrigin) return Response.json({ error: "Same-origin requests required." }, { status: 403 });
  try { await executeDocumentationRun((await params).id); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "Could not execute this run. Reload its status before retrying." }, { status: 400 }); }
}
