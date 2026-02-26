import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import Patient from "../models/Patient.js";

const rows = [
  {
    patientCode: "PAT-3001",
    mrn: "MRN-930001",
    name: "Aarav Menon",
    age: 46,
    bloodGroup: "O+",
    gender: "Male",
    diagnosis: "Knee OA",
    allergies: ["Penicillin"],
    contactNumber: "9000011111",
    pacStatus: "Incomplete"
  },
  {
    patientCode: "PAT-3002",
    mrn: "MRN-930002",
    name: "Nisha Rao",
    age: 62,
    bloodGroup: "AB-",
    gender: "Female",
    diagnosis: "CAD Triple Vessel",
    allergies: ["Latex"],
    contactNumber: "9000022222",
    pacStatus: "Incomplete"
  },
  {
    patientCode: "PAT-3003",
    mrn: "MRN-930003",
    name: "Kabir Jain",
    age: 34,
    bloodGroup: "B+",
    gender: "Male",
    diagnosis: "Acute Appendicitis",
    allergies: [],
    contactNumber: "9000033333",
    pacStatus: "Incomplete"
  }
];

async function run() {
  try {
    await connectDb(env.mongoUri);
    let upserted = 0;
    for (const item of rows) {
      await Patient.findOneAndUpdate(
        { patientCode: item.patientCode },
        item,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      upserted += 1;
    }
    logger.info("Test patients seeded", { upserted });
  } catch (err) {
    logger.error("Failed to seed test patients", { error: err.message });
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
