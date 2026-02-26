import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import Procedure from "../models/Procedure.js";
import Personnel from "../models/Personnel.js";

async function run() {
  try {
    await connectDb(env.mongoUri);

    logger.info("=== CLEANING UP INVALID PROCEDURE TEAM REFERENCES ===");

    const allPersonnelIds = new Set((await Personnel.find().select("_id")).map(p => p._id.toString()));
    const procedures = await Procedure.find();

    let cleanedCount = 0;

    for (const proc of procedures) {
      let modified = false;

      // Check and clean nurses array
      if (proc.team?.nurses?.length > 0) {
        const validNurses = proc.team.nurses.filter(nurseId => {
          const nid = nurseId?._id?.toString() || nurseId?.toString();
          const isValid = allPersonnelIds.has(nid);
          if (!isValid) {
            logger.warn(`Removing invalid nurse ${nid} from procedure ${proc.caseId}`);
          }
          return isValid;
        });

        if (validNurses.length !== proc.team.nurses.length) {
          proc.team.nurses = validNurses;
          modified = true;
        }
      }

      if (modified) {
        await proc.save();
        cleanedCount++;
        logger.info(`Cleaned procedure ${proc.caseId}`);
      }
    }

    logger.info(`Procedures cleaned: ${cleanedCount}`);

  } catch (err) {
    logger.error("Cleanup failed", { error: err.message });
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
