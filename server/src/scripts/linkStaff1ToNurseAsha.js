import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import User from "../models/User.js";
import Personnel from "../models/Personnel.js";

async function run() {
  try {
    await connectDb(env.mongoUri);
    const nurse = await Personnel.findOne({ name: "Nurse Asha", role: "Nurse" });
    const staff1 = await User.findOne({ email: "staff1@otscheduler.local" });

    if (!nurse) {
      logger.error("Nurse Asha personnel record not found");
      process.exitCode = 1;
      return;
    }
    if (!staff1) {
      logger.error("staff1@otscheduler.local user not found");
      process.exitCode = 1;
      return;
    }

    staff1.role = "ot_staff";
    staff1.personnelProfile = nurse._id;
    await staff1.save();

    const linked = await User.find({ role: "ot_staff", personnelProfile: nurse._id }).select("email");
    logger.info("staff1 linked to Nurse Asha", {
      nurseId: String(nurse._id),
      linkedUsers: linked.map((u) => u.email)
    });
  } catch (err) {
    logger.error("Failed to link staff1 to Nurse Asha", { error: err.message });
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
