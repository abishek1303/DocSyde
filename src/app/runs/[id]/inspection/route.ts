import { getRunInspection } from "@/features/documentation/runs/read-run-inspection";
// Node.js is the application default; Cache Components disallows segment runtime config.
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await getRunInspection((await params).id);
    return Response.json(result ?? { error: "Run not found." }, { status: result ? 200 : 404, headers });
  } catch { return Response.json({ error: "Inspection unavailable." }, { status: 400, headers }); }
}
