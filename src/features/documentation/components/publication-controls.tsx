import { getPublication, savedDocumentCoordinates } from "../publication-operations";
import { PublicationForm } from "./publication-form";

export async function PublicationControls({ draftId, repository }: { draftId: string; repository: string }) {
  const route = "/requests/new";
  let data;
  try {
    const coordinates = savedDocumentCoordinates(repository);
    const publication = await getPublication({ ...coordinates, route });
    data = { coordinates, publication };
  } catch { /* Read failures leave the immutable reader usable. */ }
  if (!data) return <p role="alert" className="mb-8">Publication controls unavailable. Check repository access, PostgreSQL and migrations.</p>;
  return <PublicationForm key={draftId} {...data.coordinates} draftId={draftId} initial={{ route, available: true, publication: data.publication ? { id: data.publication.id, draftId: data.publication.draftId } : null, message: "Publish only after reviewing this document." }} />;
}
