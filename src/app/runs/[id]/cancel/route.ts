import { cancelDocumentationRun } from "@/features/documentation/runs/run-coordinator";
import { RunBusyError } from "@/features/documentation/runs/run-coordinator";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Next can normalize request.url to localhost while the browser uses 127.0.0.1.
  // Compare the browser Origin with the actual HTTP Host, not that internal URL.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin = origin.host === request.headers.get("host") && origin.protocol === new URL(request.url).protocol;
  } catch { /* Missing or malformed origins are rejected. */ }
  if (!sameOrigin) return Response.json({ error: "Same-origin requests required." }, { status: 403 });
  try { const result = await cancelDocumentationRun((await params).id); return Response.json(result, { status: 202 }); }
  catch (error) { if (error instanceof RunBusyError) return Response.json({ error: error.message }, { status: 409 }); return Response.json({ error: "Could not cancel this run. Reload its status before retrying." }, { status: 400 }); }
}
