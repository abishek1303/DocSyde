import { ChangeAnalysisForm } from "@/features/sources/components/change-analysis-form";
export default function Home() {
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-12"><header><h1 className="text-3xl font-semibold tracking-tight">DocSyde</h1><p className="mt-2 text-muted-foreground">Understand source changes, with evidence and explicit uncertainty.</p></header><ChangeAnalysisForm /></main>;
}
