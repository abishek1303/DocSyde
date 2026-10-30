import { test } from "node:test";
import assert from "node:assert/strict";
import { hostPathname, publicationRoute } from "./publication-target";

test("exact pathnames: query/hash ignored only for host matching, ambiguous targets rejected", () => {
  assert.equal(hostPathname("/requests/new?from=list#help"), "/requests/new");
  assert.equal(hostPathname("/Requests/new"), "/Requests/new");
  assert.notEqual(hostPathname("/requests/123"), "/requests/new");
  assert.equal(publicationRoute.parse("/"), "/");
  for (const route of ["", "requests/new", "https://host/requests/new", "//host", "/requests/new/", "/requests//new", "/requests/../new", "/requests/./new", "/requests/:id", "/requests/*", "/requests/%6eew", "/requests/ new", "/requests/\\new", "/requests/new?x=1", "/requests/new#help", "/" + "a".repeat(300)]) {
    assert.equal(publicationRoute.safeParse(route).success, false, route);
  }
});
