import Doctor from "../models/Doctor.js";
import Procedure from "../models/Procedure.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

export const getDoctorDirectory = asyncHandler(async (_req, res) => {
  const doctors = await Doctor.find({ active: true }).select("doctorCode name specialization maxHoursPerWeek preferences");
  res.json(doctors);
});

export const getDoctorSchedule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schedules = await Procedure.find({ "team.surgeon": id })
    .populate("patientId", "patientCode name")
    .populate("otRoomId", "otCode")
    .sort({ "schedule.plannedStartTime": 1 });
  res.json(schedules);
});

export const getMyPreferenceCards = asyncHandler(async (req, res) => {
  if (req.user.role !== "surgeon" || !req.user.doctorProfile) throw new ApiError(403, "Surgeon profile required");
  const doctor = await Doctor.findById(req.user.doctorProfile).select("preferences.materialTemplates name");
  if (!doctor) throw new ApiError(404, "Doctor profile not found");
  res.json({ doctorId: doctor._id, doctorName: doctor.name, templates: doctor.preferences?.materialTemplates || [] });
});

export const upsertMyPreferenceCard = asyncHandler(async (req, res) => {
  if (req.user.role !== "surgeon" || !req.user.doctorProfile) throw new ApiError(403, "Surgeon profile required");
  const procedureType = String(req.body.procedureType || "").trim();
  const materials = Array.isArray(req.body.materials) ? req.body.materials : [];
  if (!procedureType) throw new ApiError(400, "procedureType is required");

  const doctor = await Doctor.findById(req.user.doctorProfile);
  if (!doctor) throw new ApiError(404, "Doctor profile not found");

  const cleanedMaterials = materials
    .filter((m) => m?.name)
    .map((m) => ({ name: String(m.name).trim(), quantity: Number(m.quantity || 1) }));

  const idx = (doctor.preferences?.materialTemplates || []).findIndex(
    (entry) => String(entry.procedureType || "").toLowerCase() === procedureType.toLowerCase()
  );
  if (idx >= 0) {
    doctor.preferences.materialTemplates[idx].materials = cleanedMaterials;
    doctor.preferences.materialTemplates[idx].procedureType = procedureType;
  } else {
    doctor.preferences.materialTemplates.push({ procedureType, materials: cleanedMaterials });
  }
  await doctor.save();

  res.status(201).json({ procedureType, materials: cleanedMaterials });
});
