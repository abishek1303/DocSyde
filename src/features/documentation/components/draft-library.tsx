import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { listDocumentationDrafts } from "../operations";
export async function DocumentationList({ repository, limit = 20, before }: { repository: string; limit?: number; before?: { savedAt: string; id: string } }) {
  const page = await listDocumentationDrafts({ repository, limit, before }).catch(() => null);
  if (!page) return <p role="alert" className="py-6 text-sm text-muted-foreground">Saved drafts are unavailable. Check PostgreSQL and migrations, then reload.</p>;
    return <div className="space-y-5">{!page.entries.length && <p className="py-6 text-sm leading-6 text-muted-foreground">No saved drafts for this repository yet. Drafts you save from the source tools will appear here.</p>}<ul className="divide-y">{page.entries.map(entry => <li key={entry.id} className="space-y-2 py-4"><Link className="block break-words font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring" href={`/documentation/drafts/${entry.id}?${new URLSearchParams({ repository })}`}>{entry.status === "available" ? entry.title : "Unavailable draft"}</Link><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">Draft</Badge><time dateTime={entry.savedAt.toISOString()}>Saved {entry.savedAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}</time></div></li>)}</ul>{page.nextCursor && limit > 5 && <Link className="text-sm underline" href={`/docs?${new URLSearchParams({ repository: new URL(repository).pathname.slice(1), view: "library", before: page.nextCursor.savedAt, id: page.nextCursor.id })}`}>Older drafts</Link>}</div>;

}
