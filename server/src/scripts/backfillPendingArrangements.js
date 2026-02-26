import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { backfillPendingArrangementSchedules } from "../services/dataRepairService.js";

async function run() {
  try {
    await connectDb(env.mongoUri);
    const result = await backfillPendingArrangementSchedules();
    logger.info("Backfill script finished", result);
    process.exit(0);
  } catch (err) {
    logger.error("Backfill script failed", { error: err.message });
    process.exit(1);
  }
}

run();

