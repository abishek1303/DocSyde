import { z } from "zod";

export const COMMIT_PAGE_SIZE = 10;

const pagination = z.object({
  page: z.string().regex(/^[1-9]\d*$/).default("1").transform(Number).pipe(z.number().int().max(10000)),
});

export function parseChangePagination(input: unknown) {
  return pagination.parse(input);
}
