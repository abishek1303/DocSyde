"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ModelUsageSummary } from "../../runs/run-invocation-summary";

export function ModelUsageTable({ invocations, repository }: { invocations: ModelUsageSummary[]; repository: string }) {
  const router = useRouter();
  return <div className="overflow-hidden rounded-xl border bg-card"><Table className="min-w-[1000px]">
    <TableCaption className="sr-only">AI model invocations for {repository}, newest first. Open an invocation for full details. Dates are Pacific time.</TableCaption>
    <TableHeader><TableRow>{["Started", "Operation / stage", "Provider / model", "Status / failure", "Input tokens", "Output tokens", "Completion reason", "Latency", "Run"].map(label => <TableHead key={label} scope="col" className="px-4 py-3 text-xs">{label}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{invocations.map(row => {
      const query = new URLSearchParams({ repository });
      const href = `/ai-model-usage/${row.id}?${query}`;
      return <TableRow key={row.id} className="cursor-pointer" onClick={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.target instanceof Element && event.target.closest("a"))) return;
        router.push(href);
      }}>
        <TableCell className="px-4 py-4 text-xs"><time dateTime={row.createdAt}><span className="block">{new Date(row.createdAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium" })}</span><span className="mt-1 block text-muted-foreground">{new Date(row.createdAt).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", timeStyle: "short" })} PT</span></time></TableCell>
        <TableCell className="px-4"><Link href={href} className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">{row.operation}</Link><span className="mt-1 block text-xs text-muted-foreground">{row.stage}</span></TableCell>
        <TableCell className="max-w-64 whitespace-normal break-words px-4">{row.model ?? "Unavailable"}<span className="mt-1 block text-xs text-muted-foreground">{row.provider}</span></TableCell>
        <TableCell className="px-4">{row.status}<span className="mt-1 block text-xs text-muted-foreground">{row.failureKind ?? "—"}</span></TableCell>
        <TableCell className="px-4">{row.inputTokens ?? "Unavailable"}</TableCell>
        <TableCell className="px-4">{row.outputTokens ?? "Unavailable"}</TableCell>
        <TableCell className="px-4">{row.completionReason ?? "Unavailable"}</TableCell>
        <TableCell className="px-4">{row.elapsedMs === null ? "Unavailable" : `${row.elapsedMs} ms`}</TableCell>
        <TableCell className="px-4"><Link href={`/runs/${row.runId}?${query}`} className="font-mono text-xs hover:text-primary hover:underline" aria-label={`Open run ${row.runId}`}>{row.runId.slice(0, 8)}</Link></TableCell>
      </TableRow>;
    })}</TableBody>
  </Table></div>;
}

export function RefreshModelUsage() {
  const router = useRouter();
  return <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>Refresh logs</Button>;
}
