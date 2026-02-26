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
    if (!nurse) {
      logger.info("No personnel found for Nurse Asha");
      return;
    }

    const users = await User.find({ role: "ot_staff", personnelProfile: nurse._id });
    const keepEmail = "staff1@otscheduler.local";
    const toDelete = users.filter((u) => u.email !== keepEmail);

    logger.info("Nurse Asha linked users", {
      total: users.length,
      keep: keepEmail,
      emails: users.map((u) => u.email)
    });

    if (!toDelete.length) {
      logger.info("No duplicate Nurse Asha users found");
      return;
    }

    const result = await User.deleteMany({ _id: { $in: toDelete.map((u) => u._id) } });
    const remaining = await User.find({ role: "ot_staff", personnelProfile: nurse._id }).select("email");
    logger.info("Duplicate Nurse Asha users removed", {
      deleted: result.deletedCount || 0,
      remaining: remaining.map((u) => u.email)
    });
  } catch (err) {
    logger.error("Failed to fix duplicate Nurse Asha users", { error: err.message });
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
