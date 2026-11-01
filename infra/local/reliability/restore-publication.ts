/** Experiment cleanup only. Each mutation is one existing CAS/insert operation; never retry or overwrite. */
export async function restorePublication(input: {
  scenarioPublicationId?: string; originalDocumentId: string | null; originalRemoved: boolean;
}, operations: {
  remove(observedId: string): Promise<boolean>;
  currentDocument(): Promise<string | null>;
  insert(documentId: string): Promise<boolean>;
  deliveredDocument(): Promise<string | null>;
  event(value: unknown): Promise<void>;
}) {
  const issues: string[] = [];
  const attempt = async (code: string, action: () => Promise<void>) => { try { await action(); } catch { issues.push(code); } };
  if (input.scenarioPublicationId) {
    await attempt("scenario-unpublish", async () => {
      if (!await operations.remove(input.scenarioPublicationId!)) throw new Error("Conflict");
    });
    await attempt("empty-after-unpublish", async () => {
      if (await operations.currentDocument() !== null || await operations.deliveredDocument() !== null) throw new Error("Delivery not empty");
    });
    await attempt("cleanup-journal", () => operations.event({ step: "scenario-unpublished", publicationId: input.scenarioPublicationId }));
  }
  // Even failed observations/journaling must not skip attempting safe restoration.
  if (input.originalRemoved && input.originalDocumentId) {
    await attempt("original-restore", async () => { if (!await operations.insert(input.originalDocumentId!)) throw new Error("Conflict"); });
  }
  let restored = false;
  await attempt("restored-delivery", async () => {
    restored = await operations.currentDocument() === input.originalDocumentId && await operations.deliveredDocument() === input.originalDocumentId;
    if (!restored) throw new Error("Restoration unverified");
  });
  await attempt("cleanup-journal", () => operations.event({ step: "restoration-result", originalDocumentId: input.originalDocumentId, restored, issues: [...issues] }));
  return { restored, verified: restored && issues.length === 0, issues };
}
