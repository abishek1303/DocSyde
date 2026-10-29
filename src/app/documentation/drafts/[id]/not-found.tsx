import Link from "next/link";

export default function DraftNotFound() {
  return <main className="space-y-4 p-6"><h1>Draft not found</h1><p>No saved draft exists with this ID.</p><Link href="/documentation/drafts" className="underline">Browse saved drafts</Link></main>;
}
