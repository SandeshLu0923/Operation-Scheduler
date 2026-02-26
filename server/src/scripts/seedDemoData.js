import mongoose from "mongoose";
import dayjs from "dayjs";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { connectDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import User from "../models/User.js";
import Doctor from "../models/Doctor.js";
import Patient from "../models/Patient.js";
import OperationTheater from "../models/OperationTheater.js";
import Personnel from "../models/Personnel.js";
import Procedure from "../models/Procedure.js";

async function upsertDoctor(payload) {
  return Doctor.findOneAndUpdate({ doctorCode: payload.doctorCode }, payload, { new: true, upsert: true, setDefaultsOnInsert: true });
}

async function upsertPatient(payload) {
  return Patient.findOneAndUpdate({ patientCode: payload.patientCode }, payload, { new: true, upsert: true, setDefaultsOnInsert: true });
}

async function upsertOt(payload) {
  return OperationTheater.findOneAndUpdate({ otCode: payload.otCode }, payload, { new: true, upsert: true, setDefaultsOnInsert: true });
}

async function upsertPersonnel(payload) {
  return Personnel.findOneAndUpdate({ staffCode: payload.staffCode }, payload, { new: true, upsert: true, setDefaultsOnInsert: true });
}

async function upsertProcedure(payload) {
  return Procedure.findOneAndUpdate({ procedureCode: payload.procedureCode }, payload, { new: true, upsert: true, setDefaultsOnInsert: true });
}

async function upsertUserByEmail(payload) {
  return User.findOneAndUpdate({ email: payload.email }, payload, { new: true, upsert: true, setDefaultsOnInsert: true });
}

async function seedDemoData() {
  await connectDb(env.mongoUri);

  const adminEmail = process.env.ADMIN_SEED_EMAIL || "admin@operation-scheduler.local";
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || "Admin@12345";
  const passHash = await bcrypt.hash(adminPassword, 10);

  const [docA, docB, docC] = await Promise.all([
    upsertDoctor({ doctorCode: "DOC-1001", name: "Dr. Maya Verma", specialization: "General Surgery", maxHoursPerWeek: 48, active: true, preferences: { materialTemplates: [{ procedureType: "Laparoscopic Cholecystectomy", materials: [{ name: "LaparoscopyTower", quantity: 1 }] }] } }),
    upsertDoctor({ doctorCode: "DOC-1002", name: "Dr. Arjun Mehta", specialization: "Trauma Surgery", maxHoursPerWeek: 48, active: true }),
    upsertDoctor({ doctorCode: "DOC-1003", name: "Dr. Isha Patel", specialization: "GI Surgery", maxHoursPerWeek: 44, active: true })
  ]);

  const [anesA, anesB, nurseA, nurseB, nurseC] = await Promise.all([
    upsertPersonnel({ staffCode: "AN-4001", name: "Dr. Neeraj Sen", role: "Anesthesiologist", shiftStart: "00:00", shiftEnd: "23:59", active: true }),
    upsertPersonnel({ staffCode: "AN-4002", name: "Dr. Leena Iyer", role: "Anesthesiologist", shiftStart: "00:00", shiftEnd: "23:59", active: true }),
    upsertPersonnel({ staffCode: "NR-5001", name: "Nurse Asha", role: "Nurse", shiftStart: "00:00", shiftEnd: "23:59", active: true }),
    upsertPersonnel({ staffCode: "NR-5002", name: "Nurse Bimal", role: "Nurse", shiftStart: "00:00", shiftEnd: "23:59", active: true }),
    upsertPersonnel({ staffCode: "NR-5003", name: "Nurse Charu", role: "Nurse", shiftStart: "00:00", shiftEnd: "23:59", active: true })
  ]);

  const [patientA, patientB, patientC] = await Promise.all([
    upsertPatient({ patientCode: "PAT-2001", mrn: "MRN-900001", name: "Rohan S", age: 42, bloodGroup: "B+", gender: "Male", diagnosis: "Gallbladder Stones" }),
    upsertPatient({ patientCode: "PAT-2002", mrn: "MRN-900002", name: "Anita K", age: 55, bloodGroup: "O+", gender: "Female", diagnosis: "Appendicitis" }),
    upsertPatient({ patientCode: "PAT-2003", mrn: "MRN-900003", name: "Ishaan P", age: 31, bloodGroup: "A-", gender: "Male", diagnosis: "Internal Trauma" })
  ]);

  const [ot1, ot2, ot3, ot4] = await Promise.all([
    upsertOt({
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
        "Titanium Mesh": 6
      },
      active: true
    }),
    upsertOt({
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
    }),
    upsertOt({
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
    }),
    upsertOt({
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
    })
  ]);

  nurseA.assignedOtRoom = ot1._id;
  nurseB.assignedOtRoom = ot1._id;
  nurseC.assignedOtRoom = ot2._id;
  await Promise.all([nurseA.save(), nurseB.save(), nurseC.save()]);

  const admin = await upsertUserByEmail({
    name: "System Admin",
    email: adminEmail,
    password: passHash,
    role: "ot_admin"
  });

  await Promise.all([
    upsertUserByEmail({ name: docA.name, email: "surgeon1@otscheduler.local", password: passHash, role: "surgeon", doctorProfile: docA._id }),
    upsertUserByEmail({ name: nurseA.name, email: "staff1@otscheduler.local", password: passHash, role: "ot_staff", personnelProfile: nurseA._id }),
    upsertUserByEmail({ name: anesA.name, email: "anes1@otscheduler.local", password: passHash, role: "ot_staff", personnelProfile: anesA._id })
  ]);

  const base = dayjs().add(1, "day").hour(8).minute(0).second(0).millisecond(0);

  await Promise.all([
    upsertProcedure({
      caseId: "OT-2026-001",
      procedureCode: "PR-3001",
      title: "Laparoscopic Cholecystectomy",
      procedureType: "Laparoscopic Cholecystectomy",
      patientId: patientA._id,
      otRoomId: ot1._id,
      team: {
        surgeon: docA._id,
        assistantMedic: docC._id,
        anesthesiologist: anesA._id,
        anesthesiaType: "General",
        nurses: [nurseA._id, nurseB._id]
      },
      schedule: {
        date: base.startOf("day").toDate(),
        plannedStartTime: base.add(1, "hour").toDate(),
        plannedEndTime: base.add(3, "hour").toDate(),
        bufferEndTime: base.add(3, "hour").add(30, "minute").toDate(),
        estimatedDurationMinutes: 120,
        estimatedFinishTime: base.add(3, "hour").toDate()
      },
      preOpChecklist: {
        patientIdentityVerified: true,
        consentVerified: true,
        surgicalSiteMarked: true,
        anesthesiaMachineCheck: "Pass",
        pulseOximeterFunctional: true,
        allergyReviewDone: true,
        npoStatusConfirmed: true,
        equipmentReadinessConfirmed: true,
        safetyTimeoutConfirmed: true
      },
      resources: {
        materials: [{ name: "LaparoscopyTower", quantity: 1, consumed: 0 }],
        drugs: ["Antibiotic"],
        instruments: ["Laparoscope"],
        specialRequirements: "Monitor blood pressure every 10 min"
      },
      status: "Scheduled",
      roomStatus: "Ready",
      priority: "Elective",
      surgeonReady: true,
      createdBy: admin._id,
      statusHistory: [{ status: "Scheduled", note: "Seeded", changedBy: admin._id }]
    }),
    upsertProcedure({
      caseId: "OT-2026-002",
      procedureCode: "PR-3002",
      title: "Emergency Trauma Exploration",
      procedureType: "Trauma",
      patientId: patientC._id,
      otRoomId: ot2._id,
      team: {
        surgeon: docB._id,
        assistantMedic: docA._id,
        anesthesiologist: anesB._id,
        anesthesiaType: "General",
        nurses: [nurseC._id]
      },
      schedule: {
        date: base.startOf("day").toDate(),
        plannedStartTime: base.add(4, "hour").toDate(),
        plannedEndTime: base.add(6, "hour").toDate(),
        bufferEndTime: base.add(6, "hour").add(30, "minute").toDate(),
        estimatedDurationMinutes: 120,
        estimatedFinishTime: base.add(6, "hour").toDate()
      },
      resources: {
        materials: [{ name: "VentilatorSet", quantity: 1, consumed: 0 }],
        drugs: ["Sedative"],
        instruments: ["Emergency Kit"]
      },
      status: "Scheduled",
      roomStatus: "Idle",
      priority: "Emergency",
      createdBy: admin._id,
      statusHistory: [{ status: "Scheduled", note: "Seeded", changedBy: admin._id }]
    }),
    upsertProcedure({
      caseId: "OT-2026-003",
      procedureCode: "PR-3003",
      title: "Appendectomy",
      procedureType: "Appendectomy",
      patientId: patientB._id,
      otRoomId: ot1._id,
      team: {
        surgeon: docC._id,
        assistantMedic: docA._id,
        anesthesiologist: anesA._id,
        anesthesiaType: "General",
        nurses: [nurseB._id]
      },
      schedule: {
        date: base.startOf("day").toDate(),
        plannedStartTime: base.add(7, "hour").toDate(),
        plannedEndTime: base.add(8, "hour").toDate(),
        bufferEndTime: base.add(8, "hour").add(30, "minute").toDate(),
        estimatedDurationMinutes: 60,
        estimatedFinishTime: base.add(8, "hour").toDate()
      },
      resources: {
        materials: [{ name: "Sutures", quantity: 2, consumed: 0 }],
        drugs: ["Anesthetic"],
        instruments: ["Scalpel Set"]
      },
      status: "Scheduled",
      roomStatus: "Idle",
      priority: "Elective",
      createdBy: admin._id,
      statusHistory: [{ status: "Scheduled", note: "Seeded", changedBy: admin._id }]
    })
  ]);

  logger.info("Demo data seeded", {
    adminEmail,
    defaultPassword: adminPassword,
    testUsers: ["surgeon1@otscheduler.local", "staff1@otscheduler.local", "anes1@otscheduler.local"]
  });

  await mongoose.connection.close();
}

seedDemoData().catch(async (err) => {
  logger.error("Demo seed failed", { error: err.message });
  try {
    await mongoose.connection.close();
  } catch {
    // ignore close errors
  }
  process.exit(1);
});
