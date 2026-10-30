import { updateHelpContext } from "./contextual-help.js";
import { initialRequests, createRequest, closeRequest, reopenRequest, type Request } from "./requests.js";
const key = "request-desk-baseline";
const app = document.querySelector<HTMLElement>("#app")!;
function readRequests(): Request[] {
  const raw = sessionStorage.getItem(key);
  if (!raw) return initialRequests();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every(item => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.description === "string" && ["open", "closed"].includes(item.status))) throw new Error("Stored demo data is invalid. Reset demo data to continue.");
  return value;
}
function save(requests: Request[]) { sessionStorage.setItem(key, JSON.stringify(requests)); }
function text(tag: string, value: string) { const element = document.createElement(tag); element.textContent = value; return element; }
function showError(error: unknown) { const alert = text("p", error instanceof Error ? error.message : "Demo storage is unavailable."); alert.setAttribute("role", "alert"); app.append(alert); }
function render() {
  app.replaceChildren();
  try {
    const requests = readRequests();
    const path = location.pathname;
    updateHelpContext(path);
    if (path === "/requests") {
      app.append(text("h1", "Requests"));
      const list = document.createElement("ul"); list.id = "request-list";
      for (const request of requests) {
        const item = document.createElement("li"); const link = document.createElement("a");
        link.href = `/requests/${request.id}`; link.textContent = request.title;
        item.append(link, text("span", ` — ${request.status}`)); list.append(item);
      }
      app.append(list);
    } else if (path === "/requests/new") {
      app.append(text("h1", "New request"));
      const form = document.createElement("form"); form.id = "request-form"; form.noValidate = true;
      form.innerHTML = '<label for="title">Title (required)</label><input id="title" name="title" required><label for="description">Description (optional)</label><textarea id="description" name="description"></textarea><button type="submit">Create request</button><p id="validation" role="alert"></p>';
      form.addEventListener("submit", event => {
        event.preventDefault();
        try {
          const data = new FormData(form);
          const next = createRequest(readRequests(), String(data.get("title") ?? ""), String(data.get("description") ?? ""));
          save(next); history.pushState(null, "", `/requests/${next.at(-1)!.id}`); render();
          const message = text("p", "Request created."); message.id = "created"; message.setAttribute("role", "status"); app.prepend(message);
        } catch (error) { form.querySelector("#validation")!.textContent = error instanceof Error ? error.message : "Could not save request."; }
      });
      app.append(form);
    } else {
      const request = requests.find(item => `/requests/${item.id}` === path);
      if (!request) { app.append(text("h1", "Request not found"), text("p", "This request does not exist in this session.")); }
      else {
        const detail = document.createElement("section"); detail.id = "request-detail";
        const description = text("p", request.description || "No description provided."); description.className = "description";
        const status = text("p", `Status: ${request.status}`); status.id = "request-status";
        detail.append(text("h1", request.title), description, status);
        if (request.status === "open") {
          const button = text("button", "Close request"); button.id = "close-request";
          button.addEventListener("click", () => { try { save(closeRequest(readRequests(), request.id)); render(); } catch (error) { showError(error); } }); detail.append(button);
        }
        if (request.status === "closed") {
          const button = text("button", "Reopen request"); button.id = "reopen-request";
          button.addEventListener("click", () => { try { save(reopenRequest(readRequests(), request.id)); render(); } catch (error) { showError(error); } }); detail.append(button);
        }
        app.append(detail);
      }
    }
    app.dataset.ready = "true";
  } catch (error) { showError(error); }
}
document.querySelector("#reset")!.addEventListener("click", () => { try { sessionStorage.removeItem(key); location.assign("/requests"); } catch (error) { showError(error); } });
window.addEventListener("popstate", render);
render();
