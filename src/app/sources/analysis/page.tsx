import Link from "next/link";
import { ProductChangeAnalysisForm } from "@/features/sources/components/product-change-analysis-form";
export default function ProductAnalysisPage() {
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-12"><Link href="/sources" className="underline">← Sources</Link><h1 className="text-3xl font-semibold">Product-change analysis</h1><p className="text-muted-foreground">Interpret changed behavior using original patches and selected pinned source context.</p><Link href="/documentation/draft" className="inline-block underline">Propose a documentation draft →</Link><ProductChangeAnalysisForm /></main>;
}
