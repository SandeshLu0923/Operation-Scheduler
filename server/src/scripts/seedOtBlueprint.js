import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import OperationTheater from "../models/OperationTheater.js";
import MobileEquipment from "../models/MobileEquipment.js";

const OT_BLUEPRINT = [
  {
    otCode: "OT-01",
    roomName: "Robotic Suite",
    location: "Block A",
    primarySpecialization: ["Urology", "Gynecology", "Bariatric", "Cardiothoracic"],
    fixedInfrastructure: ["Ceiling-Mounted Booms", "Shadowless LED Surgical Lights", "Integrated Surgical Displays"],
    functionality: "High-precision minimally invasive surgery using robotic-assisted systems.",
    capabilities: ["Robotic", "Minimally Invasive", "Urology", "Gynecology", "Bariatric", "Cardiothoracic"],
    inventory: {
      "Robotic Patient-Side Cart": 1,
      "Surgeon Console": 1,
      "EndoWrist Instruments": 8,
      "Laparoscopic Tower (Mobile)": 1,
      "Harmonic Scalpel Unit": 1,
      "Titanium Mesh": 6,
      "Portable Monitor Cart": 1
    },
    active: true
  },
  {
    otCode: "OT-02",
    roomName: "Cardiac Hybrid",
    location: "Block B",
    primarySpecialization: ["Vascular Repair", "Interventional Cardiology (TAVI)", "Complex Trauma"],
    fixedInfrastructure: ["Fixed Angiography C-Arm", "Radiolucent Carbon Fiber Table", "Lead-Lined Walls & Doors"],
    functionality: "Hybrid radiology + sterile theater for concurrent open and endovascular procedures.",
    capabilities: ["Cardiac", "Vascular", "Hybrid", "Trauma"],
    inventory: {
      "Cardiopulmonary Bypass (Heart-Lung Machine)": 1,
      "Contrast Media Injector": 2,
      "Perfusion Trolley": 1,
      "Electrosurgical Generator (ESU)": 1
    },
    active: true
  },
  {
    otCode: "OT-03",
    roomName: "Ortho-Specialized",
    location: "Block C",
    primarySpecialization: ["Joint Replacement (Hip/Knee)", "Fracture Management", "Spine Surgery"],
    fixedInfrastructure: ["Laminar Air Flow System", "Wall-Mounted X-Ray View Boxes", "Pendant Gas Systems"],
    functionality: "High-impact bone procedures requiring specialized positioning and heavy imaging.",
    capabilities: ["Orthopedic", "Spine", "Trauma"],
    inventory: {
      "Fracture Table": 1,
      "C-Arm Fluoroscopy Machine": 1,
      "Pneumatic Bone Drill/Saw": 2,
      "Bone Cement": 10,
      "Titanium Hip Prosthesis (Size 4)": 4
    },
    active: true
  },
  {
    otCode: "OT-04",
    roomName: "Neuro Microsurgery Suite",
    location: "Block D",
    primarySpecialization: ["Brain Tumor Resection", "Spinal Fusion", "Deep Brain Stimulation"],
    fixedInfrastructure: ["Robotic 3D Surgical Microscope", "Neuro-Navigation Infrastructure", "Specialized Neuro-Attachment Brackets"],
    functionality: "Delicate microsurgery requiring advanced navigation and high-magnification visualization.",
    capabilities: ["Neuro", "Microsurgery", "Spine"],
    inventory: {
      "High-Speed Drill System": 2,
      "Ultrasonic Surgical Aspirator (CUSA)": 1,
      "Bipolar Forceps Set": 4
    },
    active: true
  }
];

const MOBILE_POOL = [
  { name: "Mobile C-Arm (X-Ray)", quantity: 2 },
  { name: "Portable Ultrasound", quantity: 2 },
  { name: "Laparoscopic Tower (Mobile)", quantity: 2 },
  { name: "Harmonic Scalpel Unit", quantity: 2 },
  { name: "Electrosurgical Generator (ESU)", quantity: 3 },
  { name: "Mobile Robotic Unit #2", quantity: 1 },
  { name: "Portable Monitor Cart", quantity: 3 },
  { name: "Portable Neuro Navigation Cart", quantity: 1 },
  { name: "Titanium Mesh", quantity: 20 }
];

async function run() {
  await connectDb(env.mongoUri);

  for (const ot of OT_BLUEPRINT) {
    await OperationTheater.findOneAndUpdate(
      { otCode: ot.otCode },
      ot,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  for (const item of MOBILE_POOL) {
    await MobileEquipment.findOneAndUpdate(
      { name: item.name },
      { ...item, active: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  logger.info("OT blueprint seeded", {
    rooms: OT_BLUEPRINT.map((r) => r.otCode),
    mobilePool: MOBILE_POOL.map((m) => `${m.name}:${m.quantity}`)
  });
  await mongoose.connection.close();
}

run().catch(async (err) => {
  logger.error("OT blueprint seed failed", { error: err.message });
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
