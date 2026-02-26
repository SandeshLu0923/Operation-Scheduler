import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import Procedure from "../models/Procedure.js";
import Patient from "../models/Patient.js";
import AuditLog from "../models/AuditLog.js";
import Alert from "../models/Alert.js";
import SurgeryRequest from "../models/SurgeryRequest.js";

async function run() {
  try {
    await connectDb(env.mongoUri);
    const clearPatients = process.argv.includes("--with-patients");

    const [procedures, requests, auditLogs, alerts] = await Promise.all([
      Procedure.deleteMany({}),
      SurgeryRequest.deleteMany({}),
      AuditLog.deleteMany({}),
      Alert.deleteMany({})
    ]);
    let patientsDeleted = 0;
    if (clearPatients) {
      const patients = await Patient.deleteMany({});
      patientsDeleted = patients.deletedCount || 0;
    }

    logger.info("Operational data cleared", {
      proceduresDeleted: procedures.deletedCount || 0,
      patientsDeleted,
      requestsDeleted: requests.deletedCount || 0,
      auditLogsDeleted: auditLogs.deletedCount || 0,
      alertsDeleted: alerts.deletedCount || 0,
      clearPatients
    });
  } catch (err) {
    logger.error("Failed to clear operational data", { error: err.message });
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
