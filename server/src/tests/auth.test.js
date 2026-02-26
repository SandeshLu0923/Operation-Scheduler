import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { auth } from "../middlewares/auth.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err || null));
  });
}

test("auth middleware returns 401 when token is missing", async () => {
  const req = { headers: {} };
  const middleware = auth();
  const err = await runMiddleware(middleware, req);
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Unauthorized");
});

test("auth middleware returns 401 for invalid token", async () => {
  const req = { headers: { authorization: "Bearer invalid-token" } };
  const middleware = auth();
  const err = await runMiddleware(middleware, req);
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Invalid token");
});

test("auth middleware returns 403 when role is not allowed", async () => {
  const token = jwt.sign({ id: "u1", role: "ot_staff" }, env.jwtSecret);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const middleware = auth(["ot_admin"]);
  const err = await runMiddleware(middleware, req);
  assert.ok(err instanceof ApiError);
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, "Forbidden");
});

test("auth middleware sets req.user and allows valid role", async () => {
  const payload = { id: "u2", role: "ot_admin", email: "a@b.com" };
  const token = jwt.sign(payload, env.jwtSecret);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const middleware = auth(["ot_admin"]);
  const err = await runMiddleware(middleware, req);
  assert.equal(err, null);
  assert.equal(req.user.role, "ot_admin");
  assert.equal(req.user.id, "u2");
});
