import { createDocsydeClient } from "../../.artifacts/sdk/context-client.js";
import { retrieveDocumentation, type DeliveryPublication } from "../../.artifacts/sdk/documentation-client.js";

const configuration: unknown = JSON.parse(document.querySelector("#docsyde-delivery-config")!.textContent!);
if (!configuration || typeof configuration !== "object" || !("endpoint" in configuration) || !("owner" in configuration) || !("repo" in configuration) || typeof configuration.endpoint !== "string" || typeof configuration.owner !== "string" || typeof configuration.repo !== "string") throw new Error("Invalid local delivery configuration");
const { endpoint, owner, repo } = configuration;
const client = createDocsydeClient({ applicationId: "request-desk" });
const button = document.querySelector<HTMLButtonElement>("#documentation-help")!;
const content = document.querySelector<HTMLElement>("#documentation-content")!;
let controller: AbortController | undefined;
let requestNumber = 0;
let previousRoute: string | undefined;
function paragraph(value: string) {
  const p = document.createElement("p"); p.textContent = value; return p;
}
function render(publication: DeliveryPublication) {
  const title = document.createElement("h2"); title.textContent = publication.title; content.append(title);
  for (const section of publication.sections) {
    const heading = document.createElement("h3"); heading.textContent = section.title; content.append(heading);
    // Intentional escaped plain text for every Markdown block. No ad-hoc parser.
    for (const block of section.blocks) { const p = paragraph(block.markdown); p.style.whiteSpace = "pre-wrap"; content.append(p); }
    for (const q of section.qualifications) {
      content.append(paragraph(`${q.support} · ${q.confidence} confidence. ${q.confidenceReason}`));
      for (const text of [...q.assumptions, ...q.uncertainties]) content.append(paragraph(text));
    }
  }
  for (const limitation of publication.limitations) content.append(paragraph(limitation));
}
async function load() {
  controller?.abort();
  const active = controller = new AbortController();
  const number = ++requestNumber;
  content.replaceChildren(paragraph("Loading documentation…"));
  const context = client.getContext();
  if (!context) return;
  try {
    const result = await retrieveDocumentation({ endpoint, repository: { owner, repo }, context, signal: active.signal });
    if (active.signal.aborted || number !== requestNumber) return;
    content.replaceChildren();
    if (result.publication) render(result.publication);
    else content.append(paragraph("No documentation published for this page."));
  } catch {
    if (!active.signal.aborted && number === requestNumber) content.replaceChildren(paragraph("Could not load documentation. Close and reopen help to retry."));
  }
}
export function updateHelpContext(route: string) {
  if (route === previousRoute) return;
  previousRoute = route;
  controller?.abort(); requestNumber++;
  content.replaceChildren();
  client.setContext({ route });
  if (!content.hidden) void load();
}
button.addEventListener("click", () => {
  content.hidden = !content.hidden;
  button.setAttribute("aria-expanded", String(!content.hidden));
  if (!content.hidden) void load();
  else { controller?.abort(); requestNumber++; content.replaceChildren(); }
});
window.addEventListener("pagehide", event => {
  controller?.abort(); requestNumber++; content.replaceChildren();
  content.hidden = true; button.setAttribute("aria-expanded", "false");
  if (!event.persisted) client.destroy();
});
