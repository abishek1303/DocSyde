import { getPublication, savedDocumentCoordinates } from "../../publication/publication-operations";
import { getDocumentationDraft } from "../../documents/operations";
import { publicationRoute } from "../../publication/publication-target";
import { PublicationForm } from "./publication-form";

export async function PublicationControls({ draftId, repository }: { draftId: string; repository: string }) {
  let data;
  try {
    const saved = await getDocumentationDraft(draftId, repository);
    const document = saved.status === "found" ? saved.document : null;
    const associations = new Set(document ? [...document.associations, ...document.sections.flatMap(section => section.associations)] : []);
    const route = document?.context.find(choice => associations.has(choice.id) && choice.kind === "route" && publicationRoute.safeParse(choice.value).success)?.value ?? "";
    const coordinates = savedDocumentCoordinates(repository);
    const publication = route ? await getPublication({ ...coordinates, route }) : null;
    data = { coordinates, publication, route };
  } catch { /* Read failures leave the immutable reader usable. */ }
  if (!data) return <p role="alert" className="mb-8">Publishing is unavailable right now. Please reload.</p>;
  const { route } = data;
  return <PublicationForm key={draftId} {...data.coordinates} draftId={draftId} initial={{ route, available: Boolean(route), publication: data.publication ? { id: data.publication.id, draftId: data.publication.draftId } : null, message: "Publish only after reviewing this document." }} />;
}
