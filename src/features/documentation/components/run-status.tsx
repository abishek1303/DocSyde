import { CircleCheck, CircleX, Clock3, FileCheck2, LoaderCircle, Ban, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const states = {
  pending: { label: "Ready", icon: Clock3, tone: "bg-muted text-muted-foreground" },
  running: { label: "Running", icon: LoaderCircle, tone: "bg-accent text-primary" },
  "awaiting-review": { label: "Needs review", icon: FileCheck2, tone: "bg-warning-background text-warning" },
  completed: { label: "Complete", icon: CircleCheck, tone: "bg-success-background text-success" },
  "no-change": { label: "No changes needed", icon: CircleCheck, tone: "bg-success-background text-success" },
  failed: { label: "Failed", icon: CircleX, tone: "bg-destructive/10 text-destructive" },
  incomplete: { label: "Incomplete", icon: TriangleAlert, tone: "bg-warning-background text-warning" },
  "insufficient-evidence": { label: "Limited evidence", icon: TriangleAlert, tone: "bg-warning-background text-warning" },
  interrupted: { label: "Interrupted", icon: TriangleAlert, tone: "bg-warning-background text-warning" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "bg-muted text-muted-foreground" },
};
export function RunStatus({ status }: { status: string }) {
  const state = Object.hasOwn(states, status) ? states[status as keyof typeof states] : { label: "Unknown", icon: Clock3, tone: "bg-muted text-muted-foreground" };
  const Icon = state.icon;
  return <Badge variant="secondary" className={`gap-1.5 whitespace-nowrap ${state.tone}`}>
    <Icon aria-hidden="true" className={`size-3.5 ${status === "running" ? "motion-safe:animate-spin" : ""}`} />{state.label}</Badge>;
}
