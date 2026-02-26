import Procedure from "../models/Procedure.js";
import { logger } from "../config/logger.js";

export async function backfillPendingArrangementSchedules() {
  const filter = {
    status: "Scheduled",
    caseLocked: { $ne: true },
    "arrangement.requiresSurgeonAck": true,
    "arrangement.surgeonAckStatus": { $in: ["Pending", "ChangeRequested"] }
  };

  const docs = await Procedure.find(filter).select("_id caseId statusHistory");
  if (!docs.length) {
    logger.info("Data repair: no pending-arrangement schedule backfill needed");
    return { updated: 0 };
  }

  let updated = 0;
  for (const doc of docs) {
    doc.status = "Pending";
    doc.statusHistory.push({
      status: "Pending",
      note: "Backfill: moved from Scheduled to Pending until surgeon acknowledges arrangement",
      changedAt: new Date(),
      changedBy: null
    });
    await doc.save();
    updated += 1;
  }

  logger.info("Data repair completed: pending-arrangement schedules backfilled", { updated });
  return { updated };
}

