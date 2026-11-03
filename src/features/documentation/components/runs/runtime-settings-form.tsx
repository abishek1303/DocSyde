"use client";
import { useActionState } from "react";
import { configureRuntime } from "@/app/sources/runtime/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApprovedStartup } from "@/runner/runtime/managed-configuration";
import type { RuntimeSettingsState } from "../../runs/runtime-settings";

export function RuntimeSettingsForm({ repository, saved, workflowPath }: { repository: string; saved: ApprovedStartup | null; workflowPath: string }) {
  const [state, action, pending] = useActionState<RuntimeSettingsState, FormData>(configureRuntime, {});
  const value = state.preview?.input ?? saved?.input;
  return <form action={action} className="space-y-5" key={state.preview?.fingerprint ?? "initial"}>
    <input type="hidden" name="repository" value={repository} />
    <input type="hidden" name="fingerprint" value={state.preview?.fingerprint ?? ""} />
    <div className="space-y-2"><label htmlFor="checkout" className="text-sm font-medium">Local checkout directory</label><Input id="checkout" name="checkout" defaultValue={value?.checkout ?? ""} required disabled={pending} placeholder="/absolute/path/to/application" /><p className="text-xs text-muted-foreground">Its Git origin must match this project. Nothing is cloned or installed automatically.</p></div>
    <div className="space-y-2"><label htmlFor="directory" className="text-sm font-medium">Working directory within checkout</label><Input id="directory" name="directory" defaultValue={value?.directory ?? "."} required disabled={pending} /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><label htmlFor="manager" className="text-sm font-medium">Package manager</label><select id="manager" name="manager" defaultValue={value?.manager ?? ""} disabled={pending} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Detect from manifest / lockfile</option>{["npm", "pnpm", "yarn"].map(name => <option key={name} value={name}>{name}</option>)}</select></div>
      <div className="space-y-2"><label htmlFor="script" className="text-sm font-medium">Startup script</label><Input id="script" name="script" defaultValue={value?.script ?? ""} disabled={pending} placeholder="Detect dev, start or serve" /></div>
    </div>
    <div className="space-y-2"><label htmlFor="baseUrl" className="text-sm font-medium">Expected application URL</label><Input id="baseUrl" name="baseUrl" defaultValue={value?.baseUrl ?? ""} disabled={pending} placeholder="Detect a likely loopback URL" /></div>
    <div className="space-y-2"><label htmlFor="workflowPath" className="text-sm font-medium">Trusted inspection workflow file</label><Input id="workflowPath" name="workflowPath" defaultValue={value?.workflowPath ?? workflowPath} disabled={pending} required /><p className="text-xs leading-6 text-muted-foreground">Path inside DocSyde to the project’s existing workflow JSON. Its steps, masking and capture limits are preserved.</p></div>
    {state.preview && <section className="space-y-3 rounded-lg border p-4"><h2 className="font-medium">Review startup configuration</h2>
      <p className="break-words text-sm">{state.preview.input.checkout} / {state.preview.input.directory}</p>
      <code className="text-sm">{state.preview.input.manager} run {state.preview.input.script}</code>
      <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{state.preview.scripts[state.preview.input.script ?? ""]}</pre>
      <p className="text-sm">{state.preview.input.baseUrl}</p>
      <details><summary className="cursor-pointer text-sm">All manifest scripts (including lifecycle hooks)</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(state.preview.scripts, null, 2)}</pre></details>
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" name="approved" disabled={pending} className="mt-1" />I approve running this project’s code locally with my user permissions when runtime inspection is needed. No dependencies will be installed automatically.</label>
    </section>}
    <div className="flex flex-wrap gap-3"><Button name="intent" value="inspect" variant="outline" disabled={pending}>{pending ? "Checking…" : "Review configuration"}</Button>{state.preview && <Button name="intent" value="approve" disabled={pending}>Approve managed startup</Button>}{saved?.enabled && <Button name="intent" value="disable" variant="ghost" disabled={pending} formNoValidate>Disable managed startup</Button>}</div>
    {state.message && <p role="status" className="text-sm">{state.message}</p>}{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <p className="text-xs leading-6 text-muted-foreground">Suggestions are untrusted until approved. Changes to settings, scripts, lockfiles or the workflow require a new review. Raw command output is discarded to avoid retaining application secrets; sanitized process errors appear in the run’s expandable inspection details.</p>
  </form>;
}
