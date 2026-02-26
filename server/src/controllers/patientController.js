import Patient from "../models/Patient.js";
import Procedure from "../models/Procedure.js";
import Personnel from "../models/Personnel.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { emitRealtime } from "../services/realtimeService.js";

export const getPatients = asyncHandler(async (_req, res) => {
  const patients = await Patient.find();
  res.json(patients);
});

export const getPatientProcedures = asyncHandler(async (req, res) => {
  const procedures = await Procedure.find({ patientId: req.params.id })
    .populate("team.surgeon", "name specialization")
    .populate("otRoomId", "otCode")
    .sort({ "schedule.plannedStartTime": -1 });
  res.json(procedures);
});

export const updatePacStatus = asyncHandler(async (req, res) => {
  if (req.user?.role === "ot_staff") {
    const profile = req.user.personnelProfile
      ? await Personnel.findById(req.user.personnelProfile).select("role")
      : null;
    if (!profile || profile.role !== "Anesthesiologist") {
      throw new ApiError(403, "Only anesthesiologist staff can update PAC");
    }
  }
  const patient = await Patient.findById(req.params.id);
  if (!patient) throw new ApiError(404, "Patient not found");
  const pacStatus = String(req.body.pacStatus || "").trim();
  if (!["Incomplete", "Cleared"].includes(pacStatus)) {
    throw new ApiError(400, "pacStatus must be Incomplete or Cleared");
  }

  patient.pacStatus = pacStatus;
  patient.pacClearedAt = pacStatus === "Cleared" ? new Date() : null;
  await patient.save();

  if (pacStatus === "Cleared") {
    const pending = await Procedure.find({ patientId: patient._id, status: "Pending", caseLocked: false });
    for (const proc of pending) {
      const ack = proc.arrangement?.surgeonAckStatus || "NotRequired";
      const waitingForAck = proc.arrangement?.requiresSurgeonAck && (ack === "Pending" || ack === "ChangeRequested");
      if (!waitingForAck) {
        proc.status = "Scheduled";
        proc.statusHistory.push({
          status: "Scheduled",
          note: "PAC cleared and case finalized",
          changedAt: new Date(),
          changedBy: req.user?.id || null
        });
        await proc.save();
        emitRealtime("procedure:status", { caseId: proc.caseId, status: proc.status, roomStatus: proc.roomStatus });
      }
    }
  }

  res.json(patient);
});
