import { z } from "zod";

// Exact pathnames only. Reject ambiguous encodings, dot segments, patterns and
// trailing slashes rather than silently publishing to a different target.
export const publicationRoute = z.string().max(300)
  .regex(/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/)
  .refine(value => !value.split("/").some(segment => segment === "." || segment === ".."));

export function hostPathname(raw: unknown): string {
  // Query/hash do not participate in matching. This accepts a host-relative
  // route only, never an absolute URL or protocol-relative location.
  return publicationRoute.parse(z.string().max(2048).parse(raw).split(/[?#]/, 1)[0]);
}
