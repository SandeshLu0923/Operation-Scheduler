import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import User from "../models/User.js";

async function seedAdmin() {
  const adminName = process.env.ADMIN_SEED_NAME || "System Admin";
  const adminEmail = process.env.ADMIN_SEED_EMAIL || "admin@operation-scheduler.local";
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || "Admin@12345";

  await connectDb(env.mongoUri);

  const hash = await bcrypt.hash(adminPassword, 10);
  const existing = await User.findOne({ email: adminEmail });

  if (existing) {
    existing.name = adminName;
    existing.password = hash;
    existing.role = "ot_admin";
    await existing.save();
    logger.info("Admin user updated", { email: adminEmail });
  } else {
    await User.create({
      name: adminName,
      email: adminEmail,
      password: hash,
      role: "ot_admin"
    });
    logger.info("Admin user created", { email: adminEmail });
  }

  await mongoose.connection.close();
  logger.info("Seed completed");
}

seedAdmin().catch(async (err) => {
  logger.error("Admin seed failed", { error: err.message });
  try {
    await mongoose.connection.close();
  } catch {
    // ignore close errors
  }
  process.exit(1);
});
