import test from "node:test";
import assert from "node:assert/strict";
import { buildPagination } from "../utils/pagination.js";

test("buildPagination returns defaults", () => {
  const p = buildPagination({});
  assert.equal(p.page, 1);
  assert.equal(p.limit, 20);
  assert.equal(p.skip, 0);
});

test("buildPagination clamps values", () => {
  const p = buildPagination({ page: "0", limit: "900" });
  assert.equal(p.page, 1);
  assert.equal(p.limit, 100);
});
