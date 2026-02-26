import test from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../middlewares/errorHandler.js";
import { ApiError } from "../utils/ApiError.js";

function makeRes() {
  const state = { statusCode: 0, body: null };
  return {
    state,
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(payload) {
      state.body = payload;
      return this;
    }
  };
}

test("errorHandler returns status/message/details from ApiError", () => {
  const req = { path: "/api/test", method: "GET" };
  const res = makeRes();
  const err = new ApiError(409, "Conflict", { field: "otRoomId" });
  errorHandler(err, req, res, () => {});
  assert.equal(res.state.statusCode, 409);
  assert.equal(res.state.body.message, "Conflict");
  assert.deepEqual(res.state.body.details, { field: "otRoomId" });
});

test("errorHandler maps duplicate key errors to 409 response", () => {
  const req = { path: "/api/test", method: "POST" };
  const res = makeRes();
  const err = {
    code: 11000,
    keyPattern: { email: 1 },
    keyValue: { email: "user@example.com" },
    message: "duplicate key"
  };
  errorHandler(err, req, res, () => {});
  assert.equal(res.state.statusCode, 409);
  assert.equal(res.state.body.message, "email already exists: user@example.com");
  assert.deepEqual(res.state.body.details, { field: "email", value: "user@example.com" });
});
