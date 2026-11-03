import { z } from "zod";
// Canonical references only; bytes remain in the existing private artifact store.
export const documentImageSchema = z.object({
  id: z.uuid(), artifactKey: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  runId: z.uuid(), proposalId: z.uuid(), decisionId: z.string().regex(/^decision-[1-8]$/), captureId: z.uuid(),
  pathname: z.string().min(1).max(1024).regex(/^\/(?!\/)[^?#\s]*$/), capturedAt: z.iso.datetime(),
  width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192),
  alt: z.string().min(1).max(240), caption: z.string().min(1).max(300).optional(),
}).strict();
export type DocumentImage = z.infer<typeof documentImageSchema>;
export function publishedImageUrl(documentId: string, imageId: string, repository: string) {
  const name = repository.startsWith("https://github.com/") ? repository.slice("https://github.com/".length) : repository;
  return `/api/documentation/images/${documentId}/${imageId}?${new URLSearchParams({ repository: name })}`;
}
export function previewImageUrl(image: Pick<DocumentImage, "proposalId" | "id">) { return `/api/documentation/proposals/${image.proposalId}/images/${image.id}`; }
export function deliveredImage(image: DocumentImage, documentId: string, repository: string) {
  return { id: image.id, url: publishedImageUrl(documentId, image.id, repository), alt: image.alt, ...(image.caption ? { caption: image.caption } : {}), width: image.width, height: image.height };
}
