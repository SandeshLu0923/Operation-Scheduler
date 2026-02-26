import { ApiError } from "../utils/ApiError.js";

export function requireFields(fields) {
  return (req, _res, next) => {
    const missing = fields.filter((field) => req.body[field] === undefined || req.body[field] === null || req.body[field] === "");
    if (missing.length) {
      return next(new ApiError(400, "Missing required fields", { missing }));
    }
    next();
  };
}
