import Alert from "../models/Alert.js";
import { emitRealtime } from "./realtimeService.js";

export async function createAlert({ type, severity = "medium", message, source = "system", metadata = {} }) {
  const alert = await Alert.create({ type, severity, message, source, metadata });
  emitRealtime("alert:new", {
    id: alert._id,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    source: alert.source,
    createdAt: alert.createdAt
  });
  return alert;
}
