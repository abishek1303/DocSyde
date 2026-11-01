import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return <nav aria-label="Breadcrumb">
    <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {items.map((item, index) => <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-2">
        {index > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
        {item.href ? <Link href={item.href} className="max-w-64 truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">{item.label}</Link> : <span aria-current="page" className="max-w-64 truncate text-foreground">{item.label}</span>}
      </li>)}
    </ol>
  </nav>;
}
