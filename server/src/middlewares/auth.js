import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

function getToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

export function auth(requiredRoles = []) {
  return (req, _res, next) => {
    const token = getToken(req);
    if (!token) return next(new ApiError(401, "Unauthorized"));

    try {
      const payload = jwt.verify(token, env.jwtSecret);
      req.user = payload;
      if (requiredRoles.length && !requiredRoles.includes(payload.role)) {
        return next(new ApiError(403, "Forbidden"));
      }
      next();
    } catch {
      next(new ApiError(401, "Invalid token"));
    }
  };
}
