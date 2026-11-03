import { pendingDocumentImage } from "@/features/documentation/images/document-image-operations";
export async function GET(request: Request, { params }: { params: Promise<{ proposalId: string; imageId: string }> }) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
  const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || (origin && origin !== url.origin) || (site && !["same-origin", "none"].includes(site))) return new Response(null, { status: 403, headers });
  try {
    const { proposalId, imageId } = await params, bytes = await pendingDocumentImage(proposalId, imageId);
    return new Response(bytes ? Uint8Array.from(bytes) : null, { status: bytes ? 200 : 404, headers });
  } catch { return new Response(null, { status: 404, headers }); }
}
