import type { z } from "zod";
import { runRuntimeConfigSchema } from "@/features/documentation/runs/run-runtime-config";
export const REQUEST_DESK_BASE = "45799b2fae07f1326296b8ba85fae51476fd153d";
export const scenarios = ["A", "B", "C"] as const;
export type Scenario = typeof scenarios[number];
export const routes = { A: "/requests/new", B: "/requests/r-001", C: "/requests" } as const;

/** Trusted operator scripts only. No action or capability is derived from model output. */
export function scenarioWorkflow(scenario: Scenario): z.input<typeof runRuntimeConfigSchema> {
  const common = { repository: "https://github.com/abishek1303/docsyde", version: "1", maxSelectedScreenshots: 1,
    runtime: { mode: "attach" as const, options: { baseUrl: "http://127.0.0.1:45873", readinessPath: "/health" } },
    supportingSourcePaths: ["test-app/src/public/app.ts", "test-app/src/public/requests.ts", "test-app/src/server.ts"] };
  if (scenario === "A") return { ...common, id: "reliability-priority-result", supportedPathnames: ["/requests/new", "/requests/r-003"],
    description: "Explicitly select Urgent and create a request. The detail checkpoint observes resulting priority only; it does not establish the initial default. Source and separate deterministic checks establish the default. Runtime revision is operator-verified, not proven by attach.",
    capabilities: [{ id: "urgent-request-result", pathname: "/requests/new", description: "The configured workflow explicitly selects Urgent and observes priority in the resulting details. Does not verify initial default, prior behavior, close/reopen or refresh." }],
    workflow: { path: "/requests/new", readySelector: "#request-form", steps: [
      { type: "select", selector: "#priority", value: "urgent" }, { type: "fill", selector: "#title", value: "Reliability request" },
      { type: "click", selector: "button[type=submit]" }, { type: "waitFor", selector: "#request-detail" }, { type: "checkpoint" },
    ] } };
  if (scenario === "B") return { ...common, id: "reliability-close-confirmation", supportedPathnames: ["/requests/r-001"],
    description: "Trace seeded open request, reveal confirmation, cancel, then close and confirm. Prefer confirmation-controls checkpoint if useful. One image does not prove the sequence. No persistence, historical, concurrency or refresh guarantee.",
    capabilities: [{ id: "close-confirmation", pathname: "/requests/r-001", description: "Configured script observes seeded open state, Close confirmation controls, Cancel leaving open, then Confirm close reaching closed. Visual checkpoint represents confirmation controls only, not the entire interaction." }],
    workflow: { path: "/requests/r-001", readySelector: "#close-request", steps: [
      { type: "click", selector: "#close-request" }, { type: "waitFor", selector: "#close-confirmation" }, { type: "checkpoint" },
      { type: "click", selector: "#cancel-close" }, { type: "waitFor", selector: "#close-request" },
      { type: "click", selector: "#close-request" }, { type: "click", selector: "#confirm-close" }, { type: "waitFor", selector: "#reopen-request" },
    ] } };
  return { ...common, id: "reliability-status-display", supportedPathnames: ["/requests", "/requests/r-002"],
    description: "Observe Resolved terminology in request list and seeded closed-request details. Optional image represents details. Display observation does not prove domain values, transitions, persistence or historical behavior.",
    capabilities: [{ id: "resolved-status-display", pathname: "/requests", description: "Configured list/detail navigation observes displayed Resolved terminology. Does not establish stored state or transition behavior." }],
    workflow: { path: "/requests", readySelector: "#request-list", steps: [
      { type: "click", selector: 'a[href="/requests/r-002"]' }, { type: "waitFor", selector: "#request-detail" }, { type: "checkpoint" },
    ] } };
}
