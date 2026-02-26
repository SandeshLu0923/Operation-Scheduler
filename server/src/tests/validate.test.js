import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../utils/ApiError.js";
import { requireFields } from "../middlewares/validate.js";

test("requireFields passes when fields exist", () => {
  const middleware = requireFields(["name"]);
  const req = { body: { name: "ok" } };
  let called = false;
  middleware(req, {}, () => {
    called = true;
  });
  assert.equal(called, true);
});

test("requireFields returns ApiError when missing", () => {
  const middleware = requireFields(["name", "email"]);
  const req = { body: { name: "only" } };

  middleware(req, {}, (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.statusCode, 400);
    assert.deepEqual(err.details.missing, ["email"]);
  });
});
