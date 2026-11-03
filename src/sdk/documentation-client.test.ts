import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeliveryResponse, retrieveDocumentation } from "./documentation-client";
const input = { endpoint: "http://127.0.0.1:3000/api/documentation/context", repository: { owner: "Owner", repo: "Repo" }, context: { version: 1 as const, applicationId: "unrelated-host-id", route: "/requests/new", featureIds: [] } };

test("SDK explicit retrieval passes identity, context and cancellation, no credentials or cache", async t => {
  let options: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.searchParams.get("owner"), "Owner");
    assert.equal(url.searchParams.get("route"), "/requests/new");
    assert.equal(url.searchParams.has("applicationId"), false);
    options = init;
    return Response.json({ version: 1, publication: null });
  });
  const controller = new AbortController();
  assert.deepEqual(await retrieveDocumentation({ ...input, signal: controller.signal }), { version: 1, publication: null });
  assert.equal(options?.signal, controller.signal);
  assert.equal(options?.credentials, "omit");
  assert.equal(options?.cache, "no-store");
});
test("SDK rejects HTTP, malformed payload and transport failures", async t => {
  for (const response of [new Response("bad", { status: 503 }), Response.json({ version: 2, publication: null }), Response.json({ version: 1, publication: {} })]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(() => retrieveDocumentation(input)); mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(() => retrieveDocumentation(input), /offline/);
});
test("SDK cancellation propagates without empty-result fallback", async t => {
  t.mock.method(globalThis, "fetch", (_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const controller = new AbortController();
  const pending = retrieveDocumentation({ ...input, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
test("SDK validates structured blocks and projects only the delivery contract", () => {
  const response = parseDeliveryResponse({ version: 1, publication: { id: "p", documentId: "d", publishedAt: "now", title: "Title", sections: [{ id: "s", title: "Section", blocks: [{ markdown: "**escaped text**", factRefs: ["secret"] }], qualifications: [] }], limitations: [], provenance: "secret" } });
  assert.ok(!JSON.stringify(response).includes("secret"));
  assert.equal(response.publication?.sections[0].blocks[0].markdown, "**escaped text**");
});

test("SDK images remain optional, reject private/external paths, and resolve against DocSyde", async t => {
  const image = { id: "11111111-1111-4111-8111-111111111111", url: "/api/documentation/images/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222?repository=owner%2Frepo", alt: "Issue detail screen", width: 1000, height: 700 };
  const payload = { version: 1, publication: { id: "p", documentId: "d", publishedAt: "now", title: "Title", sections: [{ id: "s", title: "Section", blocks: [], qualifications: [], images: [image] }], limitations: [] } };
  assert.deepEqual(parseDeliveryResponse(payload).publication!.sections[0].images, [image]);
  for (const url of ["file:///private/image.png", "/runs/private/preview/1", "https://example.com/private.png", "//example.com/image.png"]) {
    const invalid = structuredClone(payload); invalid.publication.sections[0].images[0].url = url; assert.throws(() => parseDeliveryResponse(invalid));
  }
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  assert.equal((await retrieveDocumentation(input)).publication!.sections[0].images![0].url, `http://127.0.0.1:3000${image.url}`);
});
