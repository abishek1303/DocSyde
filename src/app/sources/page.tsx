import Link from "next/link";
import { ChangeAnalysisForm } from "@/features/sources/components/change-analysis-form";
export default function Home() {
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-12"><Link href="/" className="text-sm underline">← Overview</Link><header><h1 className="text-3xl font-semibold tracking-tight">Source tools</h1><p className="mt-2 text-muted-foreground">Understand source changes, with evidence and explicit uncertainty.</p></header><Link href="/sources/context" className="inline-block text-sm underline">Review source files at a revision →</Link><Link href="/sources/analysis" className="inline-block text-sm underline">Analyze product changes →</Link><ChangeAnalysisForm /></main>;
}
