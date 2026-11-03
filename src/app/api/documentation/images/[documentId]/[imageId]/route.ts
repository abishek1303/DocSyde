import { publishedDocumentImage } from "@/features/documentation/images/document-image-operations";
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string; imageId: string }> }) {
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", Vary: "Origin" });
  const origin = request.headers.get("origin"), url = new URL(request.url);
  if (origin && origin !== url.origin) {
    if (origin !== process.env.DOCSYDE_HOST_ORIGIN) return new Response(null, { status: 403, headers });
    headers.set("Access-Control-Allow-Origin", origin);
  }
  try {
    const { documentId, imageId } = await params, bytes = await publishedDocumentImage(url.searchParams.get("repository"), documentId, imageId);
    return new Response(bytes ? Uint8Array.from(bytes) : null, { status: bytes ? 200 : 404, headers });
  } catch { return new Response(null, { status: 404, headers }); }
}
