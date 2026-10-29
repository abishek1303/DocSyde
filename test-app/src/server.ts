import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const assets = new Map([
  ["/app.js", [new URL("./public/app.js", import.meta.url), "text/javascript"]],
  ["/requests.js", [new URL("./public/requests.js", import.meta.url), "text/javascript"]],
  ["/styles.css", [new URL("../../public/styles.css", import.meta.url), "text/css"]],
] as const);
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1:45873").pathname;
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end("Method not allowed"); return; }
  if (path === "/health") { response.writeHead(200).end("ready"); return; }
  if (path === "/") { response.writeHead(302, { Location: "/requests" }).end(); return; }
  const asset = [...assets].find(([name]) => name === path)?.[1];
  const applicationRoute = path === "/requests" || path === "/requests/new" || /^\/requests\/[^/]+$/.test(path);
  if (!asset && !applicationRoute) { response.writeHead(404).end("Not found"); return; }
  try {
    const content = await readFile(asset?.[0] ?? new URL("../../public/index.html", import.meta.url));
    response.writeHead(200, { "Content-Type": `${asset?.[1] ?? "text/html"}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch { response.writeHead(500).end("Application assets unavailable. Run the build first."); }
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? "Port 45873 is occupied; stop the existing process before starting this app." : `Server failed: ${error.code}`);
  process.exitCode = 1;
});
server.listen(45873, "127.0.0.1", () => console.log("Test app: http://127.0.0.1:45873/requests"));
