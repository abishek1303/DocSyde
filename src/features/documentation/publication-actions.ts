"use server";
import { getPublication, publishDocumentation, unpublishDocumentation } from "./publication-operations";

export type PublicationState = {
  route: string;
  publication: { id: string; draftId: string } | null;
  message: string;
  available: boolean;
};
export async function changePublication(_previous: PublicationState, form: FormData): Promise<PublicationState> {
  const route = String(form.get("route") ?? "");
  const target = { owner: form.get("owner"), repo: form.get("repo"), route };
  try {
    const intent = form.get("intent");
    let message = "Target checked.";
    if (intent === "publish" || intent === "replace") {
      const result = await publishDocumentation({ ...target, draftId: form.get("draftId"), ...(intent === "replace" ? { observedId: form.get("observedId") } : {}) });
      message = result.status === "published" ? "Published. Saved content is unchanged." : "Publication conflict. Review the current target before replacing.";
    } else if (intent === "unpublish") {
      const result = await unpublishDocumentation({ ...target, observedId: form.get("observedId") });
      message = result.status === "unpublished" ? "Unpublished. Saved documents are unchanged." : "Publication changed. Review the current target before retrying.";
    } else if (intent !== "inspect") throw new Error("Invalid intent");
    const publication = await getPublication(target);
    return { route, publication: publication ? { id: publication.id, draftId: publication.draftId } : null, message, available: true };
  } catch {
    return { route, publication: null, available: false, message: "Could not update publication. Check the route, repository access, PostgreSQL and migrations, then check the target again." };
  }
}
