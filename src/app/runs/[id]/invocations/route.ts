import { getRunInvocations } from "@/features/documentation/runs/read-run-invocations";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { id } = await params;
    const result = await getRunInvocations(id);
    return result ? Response.json(result, { headers }) : Response.json({ error: "Run not found." }, { status: 404, headers });
  } catch {
    return Response.json({ error: "Invocation logs are unavailable. Try again." }, { status: 503, headers });
  }
}
