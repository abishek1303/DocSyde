import Link from "next/link";
import { DraftForm } from "@/features/documentation/components/draft-form";
export default function DocumentationDraftPage() {
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-12"><Link href="/sources/analysis" className="underline">← Semantic analysis</Link><h1 className="text-3xl font-semibold">Propose documentation draft</h1><p>Structured sections and explicit provenance, with Markdown used only for content.</p><DraftForm /></main>;
}
