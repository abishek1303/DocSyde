import { getRunInspectionScreenshot } from "@/features/documentation/runs/read-run-inspection";
// Node.js is the application default; Cache Components disallows segment runtime config.
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "image/png" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; captureId: string }> }) {
  try {
    const { id, captureId } = await params, bytes = await getRunInspectionScreenshot(id, captureId);
    return new Response(bytes ? Uint8Array.from(bytes) : null, { status: bytes ? 200 : 404, headers });
  } catch { return new Response(null, { status: 400, headers }); }
}
