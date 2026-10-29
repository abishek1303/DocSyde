import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { assertDocumentBytes, validateDocumentationDocument } from "./document-validation";

function signingKey(): string {
  const key = process.env.DOCSYDE_DRAFT_SIGNING_KEY;
  if (!key || key.length < 32) throw new Error("Saving requires DOCSYDE_DRAFT_SIGNING_KEY with at least 32 characters.");
  return key;
}

export function signDraftPreview(raw: unknown): { serialized: string; signature: string } {
  const document = validateDocumentationDocument(raw);
  const serialized = JSON.stringify(document);
  return { serialized, signature: createHmac("sha256", signingKey()).update(serialized, "utf8").digest("hex") };
}

export function verifyDraftPreview(serialized: unknown, signature: unknown) {
  if (typeof serialized !== "string" || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new Error("Invalid draft handoff.");
  }
  assertDocumentBytes(serialized);
  const expected = createHmac("sha256", signingKey()).update(serialized, "utf8").digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("Invalid draft signature.");
  // Authenticate the exact received bytes before parsing; never reserialize here.
  return validateDocumentationDocument(JSON.parse(serialized));
}
