import { logger } from "../config/logger.js";
import { ApiError } from "../utils/ApiError.js";

export function notFound(_req, _res, next) {
  next(new ApiError(404, "Route not found"));
}

export function errorHandler(err, req, res, _next) {
  let status = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let details = err.details || null;

  if (err?.code === 11000) {
    status = 409;
    const keys = Object.keys(err.keyPattern || err.keyValue || {});
    const field = keys[0] || "resource";
    const value = err.keyValue?.[field] ?? "";
    message = `${field} already exists${value ? `: ${value}` : ""}`;
    details = { field, value };
  }

  logger.error(err.message, {
    status,
    path: req.path,
    method: req.method,
    stack: err.stack,
    details
  });

  res.status(status).json({
    message,
    details
  });
}
