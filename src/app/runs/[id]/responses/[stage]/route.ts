import { ZodError } from "zod";
import { getRunStageResponse } from "@/features/documentation/runs/read-run-stage-response";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; stage: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { id, stage } = await params;
    const response = await getRunStageResponse(id, stage);
    return response ? Response.json(response, { headers }) : Response.json({ error: "Run not found." }, { status: 404, headers });
  } catch (error) {
    return Response.json({ error: error instanceof ZodError ? "Invalid response request or stored output." : "The saved response is unavailable. Try again or check the run’s stored data." }, { status: error instanceof ZodError ? 400 : 503, headers });
  }
}
