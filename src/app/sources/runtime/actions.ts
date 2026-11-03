"use server";
import { revalidatePath } from "next/cache";
import { approveRuntimeSettings, disableRuntimeStartup, previewRuntimeSettings, type RuntimeSettingsState } from "@/features/documentation/runs/runtime-settings";

export async function configureRuntime(_previous: RuntimeSettingsState, form: FormData): Promise<RuntimeSettingsState> {
  try {
    const repository = String(form.get("repository") ?? "");
    if (form.get("intent") === "disable") {
      await disableRuntimeStartup(repository); revalidatePath("/sources/runtime"); revalidatePath("/runs/new");
      return { message: "Managed startup disabled. Existing healthy servers can still be inspected." };
    }
    const input = { checkout: String(form.get("checkout") ?? ""), directory: String(form.get("directory") ?? "."),
      manager: form.get("manager") ? String(form.get("manager")) : undefined, script: String(form.get("script") ?? "") || undefined,
      baseUrl: String(form.get("baseUrl") ?? "") || undefined, workflowPath: String(form.get("workflowPath") ?? "") };
    const { manager, ...fields } = input;
    if (manager && !["npm", "pnpm", "yarn"].includes(manager)) throw new Error("Invalid package manager");
    const selectedManager = manager === "npm" || manager === "pnpm" || manager === "yarn" ? manager : undefined;
    const preview = await previewRuntimeSettings(repository, { ...fields, manager: selectedManager });
    if (form.get("intent") !== "approve") return { preview };
    if (form.get("approved") !== "on") return { preview, error: "Approve local execution before enabling managed startup." };
    const { repository: reviewedRepository, ...reviewedInput } = preview.input;
    void reviewedRepository;
    await approveRuntimeSettings({ repository, ...reviewedInput, fingerprint: String(form.get("fingerprint") ?? ""), confirmed: true });
    revalidatePath("/sources/runtime"); revalidatePath("/runs/new");
    return { preview, message: "Approved. DocSyde may start this exact project configuration when inspection is required." };
  } catch {
    return { error: "Could not approve these settings. Check the checkout origin, project-local working directory, installed package script and project workflow file. Review again after any edit." };
  }
}
