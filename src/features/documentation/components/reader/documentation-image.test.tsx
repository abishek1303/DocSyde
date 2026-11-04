import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentationImage } from "./documentation-image";

test("documentation images expose an accessible dialog trigger without wrapping image actions", () => {
  const html = renderToStaticMarkup(<DocumentationImage image={{ id: "image-1", alt: "Request details", caption: "A saved request", width: 1200, height: 800 }} src="/docs/image-1" actions={<button>Remove screenshot</button>} />);
  assert.match(html, /aria-label="Preview image: Request details"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /A saved request/);
  assert.ok(html.indexOf("Remove screenshot") > html.indexOf("</button>"));
});
