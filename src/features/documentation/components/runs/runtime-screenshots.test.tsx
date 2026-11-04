import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CapturedScreenshots } from "./runtime-inspection-pane";

test("artifact thumbnails use retained screenshot endpoints and open preview dialogs", () => {
  const html = renderToStaticMarkup(<CapturedScreenshots runId="run-a" captures={[{ captureId: "capture-a", selected: true }, { captureId: "capture-b", selected: false }]} />);
  assert.match(html, /\/runs\/run-a\/inspection\/screenshots\/capture-a/);
  assert.match(html, /\/runs\/run-a\/inspection\/screenshots\/capture-b/);
  assert.match(html, /Checkpoint 1 · selected/);
  assert.match(html, /Checkpoint 2/);
  assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 2);
});
