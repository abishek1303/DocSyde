import { getRunInspectionPreview } from "@/features/documentation/runs/read-run-inspection";
// Node.js is the application default; Cache Components disallows segment runtime config.
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "image/png" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; revision: string }> }) {
  try {
    const { id, revision } = await params, result = await getRunInspectionPreview(id, revision);
    return new Response(result.bytes ? Uint8Array.from(result.bytes) : null, { status: result.status, headers });
  } catch { return new Response(null, { status: 400, headers }); }
}
