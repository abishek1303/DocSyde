import { BookOpen, Check, ChevronDown, FileText } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { badgeVariants } from "@/components/ui/badge";
import type { DocumentationDocument } from "../document";
import { DraftMarkdown } from "./draft-markdown";

const disclosureStyle = "group rounded-xl border bg-card p-4 text-sm";
const summaryStyle = "flex cursor-pointer list-none items-center justify-between gap-3 font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden";

export function DraftInspector({ document, savedAt, appearance = "card" }: { document: DocumentationDocument; savedAt?: string; appearance?: "card" | "help" }) {
  const contexts = document.associations.flatMap(id => document.context.filter(choice => choice.id === id));
  const date = savedAt ? new Date(savedAt) : null;
  const savedLabel = date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }).format(date) + " PT" : null;
  return <article className="space-y-8" aria-label="Documentation draft">
    <Card className={appearance === "help" ? "gap-6 rounded-none bg-transparent py-0 ring-0" : "gap-6 py-7 sm:py-9"}>
      <CardHeader className={appearance === "help" ? "gap-5 px-0" : "gap-5 px-6 sm:px-9"}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={badgeVariants({ variant: "secondary" })}>Draft · review needed</span>
          <span className={badgeVariants({ variant: "outline" })}>{savedAt ? <><Check className="mr-1 size-3" aria-hidden="true" /> Saved</> : "Not saved"}</span>
        </div>
        <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{document.title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">Generated from source code. Review this draft before sharing it.{savedLabel && <> Saved {savedLabel}.</>}</p>
        {contexts.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Related product context">{contexts.map(context => <span key={context.id} className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">{context.value}</span>)}</div>}
      </CardHeader>
      <CardContent className={appearance === "help" ? "border-t px-0 pt-6 lg:hidden" : "border-t px-6 pt-6 sm:px-9"}>
        <nav aria-label="On this page" className="space-y-3">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase"><BookOpen className="size-4" aria-hidden="true" /> On this page</p>
          <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">{document.sections.map((section, index) => <li key={section.id}><a className="text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" href={`#section-${section.id}`}><span className="mr-2 text-muted-foreground">{index + 1}.</span>{section.title}</a></li>)}</ol>
        </nav>
      </CardContent>
    </Card>

    <div className="space-y-10 px-1 sm:px-3">
      {document.sections.map(section => {
        const caveats = [...new Set(section.qualifications.flatMap(q => [...q.assumptions, ...q.uncertainties]))];
        const inferred = section.qualifications.some(q => q.support === "inferred" || q.confidence === "low");
        return <section className="scroll-mt-48 space-y-5 sm:scroll-mt-32 lg:scroll-mt-24" id={`section-${section.id}`} key={section.id}>
          <h3 className="border-b pb-4 text-2xl font-semibold tracking-tight">{section.title}</h3>
          <div className="space-y-5 text-base leading-8 text-foreground/90 sm:text-lg">
            {section.content.map((block, index) => <div key={index} className="space-y-3 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-sm [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6"><DraftMarkdown content={block.markdown} /></div>)}
          </div>
          {(inferred || caveats.length > 0) && <aside className="space-y-2 rounded-lg border border-warning/30 bg-warning-background p-4 text-sm leading-6 text-warning"><p className="font-medium">What to keep in mind</p>{inferred && <p>Some details are inferred or have limited support. Check the sources before relying on them.</p>}{caveats.length > 0 && <ul className="list-disc space-y-1 pl-5">{caveats.map(text => <li key={text}>{text}</li>)}</ul>}</aside>}
          <details className={disclosureStyle}>
            <summary className={summaryStyle}>Sources and confidence<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
            <div className="mt-5 space-y-5 border-t pt-5 text-sm leading-6 text-muted-foreground">
              <h4 className="font-semibold text-foreground">Preserved qualifications</h4>
              {section.qualifications.map(q => <div key={q.findingRef}><p className="font-medium text-foreground">{q.support === "directly-supported" ? "Supported by the source" : "Inferred from the source"} · {q.confidence} confidence</p><p>{q.confidenceReason}</p></div>)}
              {section.content.map((block, index) => <div key={index} className="space-y-4"><h4 className="font-semibold text-foreground">Block provenance · paragraph {index + 1}</h4>{block.factRefs.map(id => {
                const fact = document.provenance.facts.find(f => f.id === id)!;
                const finding = document.provenance.findings.find(f => f.id === fact.findingRef)!;
                return <div key={id} className="space-y-3 border-l-2 pl-4"><p>{finding.description}</p>{finding.citations.map((citation, citationIndex) => {
                  const evidence = document.provenance.evidence.find(e => e.id === citation.evidenceId)!;
                  return <div key={citationIndex} className="space-y-2"><p className="break-all font-mono text-xs">{evidence.path} · {evidence.side} · lines {citation.startLine}–{citation.endLine}</p><pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{citation.excerpt}</pre></div>;
                })}</div>;
              })}</div>)}
            </div>
          </details>
        </section>;
      })}
    </div>

    <footer className="space-y-3 border-t pt-6">
      <details className={disclosureStyle}>
        <summary className={summaryStyle}>About this draft and its limitations<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
        <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">{document.provenance.limitations.map((text, index) => <p key={index}>{text}</p>)}<p>Source citations establish traceability, not proof that every generated statement is correct.</p><p className="break-all">Source: {document.provenance.repository}</p><p>Generated with {document.generation.model}</p></div>
      </details>
      <details className={disclosureStyle}>
        <summary className={summaryStyle}><span className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" aria-hidden="true" /> Developer details · canonical JSON</span><ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
        <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-5 whitespace-pre-wrap">{JSON.stringify(document, null, 2)}</pre>
      </details>
    </footer>
  </article>;
}
