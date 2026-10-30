"use server";

import { z } from "zod";
import { listDocumentationDrafts } from "@/features/documentation/operations";

export async function loadDocumentationNavigation(repository?: string) {
  const scope = z.string().url().optional().parse(repository);
  const page = await listDocumentationDrafts(scope ? { repository: scope } : {});
  return {
    entries: page.entries.map(entry => ({ id: entry.id, status: entry.status, title: entry.status === "available" ? entry.title : undefined })),
    hasOlder: Boolean(page.nextCursor),
  };
}
