import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const assets = new Map([
  ["/contextual-help.js", [new URL("./public/contextual-help.js", import.meta.url), "text/javascript"]],
  ["/.artifacts/sdk/context-client.js", [new URL("../../.artifacts/sdk/context-client.js", import.meta.url), "text/javascript"]],
  ["/.artifacts/sdk/documentation-client.js", [new URL("../../.artifacts/sdk/documentation-client.js", import.meta.url), "text/javascript"]],
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
    if (applicationRoute && request.method !== "HEAD") {
      // Local demo configuration only. These are public coordinates, never secrets.
      const endpoint = new URL(process.env.DOCSYDE_DELIVERY_ENDPOINT ?? "http://127.0.0.1:3000/api/documentation/context");
      if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Invalid delivery endpoint");
      const configuration = JSON.stringify({ endpoint: endpoint.href, owner: process.env.DOCSYDE_REPOSITORY_OWNER ?? "abishek1303", repo: process.env.DOCSYDE_REPOSITORY_NAME ?? "DocSyde" }).replace(/</g, "\\u003c");
      response.end(content.toString().replace("</head>", `<script id="docsyde-delivery-config" type="application/json">${configuration}</script></head>`));
    } else response.end(request.method === "HEAD" ? undefined : content);
  } catch { response.writeHead(500).end("Application assets unavailable. Run the build first."); }
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? "Port 45873 is occupied; stop the existing process before starting this app." : `Server failed: ${error.code}`);
  process.exitCode = 1;
});
server.listen(45873, "127.0.0.1", () => console.log("Test app: http://127.0.0.1:45873/requests"));
