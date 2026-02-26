import mongoose from "mongoose";
import { logger } from "./logger.js";

export async function connectDb(mongoUri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri);
  logger.info("Database connected");
}
