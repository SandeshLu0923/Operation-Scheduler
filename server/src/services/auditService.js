import AuditLog from "../models/AuditLog.js";
import { logger } from "../config/logger.js";

export async function logAction({ actorId, actorRole, action, entityType, entityId, metadata = {} }) {
  logger.info("Action log", { actorId, actorRole, action, entityType, entityId, metadata });
  await AuditLog.create({ actorId, actorRole, action, entityType, entityId, metadata });
}
