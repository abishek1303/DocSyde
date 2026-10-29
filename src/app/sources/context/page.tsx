import Link from "next/link";
import { SourceContextForm } from "@/features/sources/components/source-context-form";
export default function SourceContextPage() {
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-12">
    <Link href="/" className="text-sm underline">← Change summaries</Link>
    <header><h1 className="text-3xl font-semibold">Review source context</h1><p className="mt-2 text-muted-foreground">Inspect selected source files at one immutable GitHub revision.</p></header>
    <SourceContextForm />
  </main>;
}
