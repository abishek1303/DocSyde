import { getDocumentationRun, runView } from "@/features/documentation/run-operations";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const run = await getDocumentationRun((await params).id);
    return run ? Response.json(runView(run), { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Run not found." }, { status: 404 });
  } catch { return Response.json({ error: "Run status is unavailable." }, { status: 400 }); }
}
