import Doctor from "../models/Doctor.js";
import Patient from "../models/Patient.js";
import OperationTheater from "../models/OperationTheater.js";
import AuditLog from "../models/AuditLog.js";
import Personnel from "../models/Personnel.js";
import Alert from "../models/Alert.js";
import MobileEquipment from "../models/MobileEquipment.js";
import Procedure from "../models/Procedure.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logAction } from "../services/auditService.js";
import { ApiError } from "../utils/ApiError.js";

const GENERAL_OT_BASELINE_INVENTORY = {
  "Suction Set": 8,
  "Cautery Pencil": 8,
  "Surgical Drapes": 20,
  "Suture Pack": 25,
  "IV Set": 20,
  "Knee Prosthesis Set": 6,
  "Implant Guide": 6,
  "Titanium Mesh": 4,
  "Harmonic Scalpel Unit": 4
};

function mergeInventoryWithBaseline(inventoryRaw, force = false) {
  const inventory = inventoryRaw instanceof Map ? new Map(inventoryRaw) : new Map(Object.entries(inventoryRaw || {}));
  for (const [name, qty] of Object.entries(GENERAL_OT_BASELINE_INVENTORY)) {
    const current = Number(inventory.get(name) || 0);
    const nextQty = force ? qty : Math.max(current, qty);
    inventory.set(name, nextQty);
  }
  return inventory;
}

export const createDoctor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.create(req.body);
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "CREATE_DOCTOR",
    entityType: "Doctor",
    entityId: String(doctor._id),
    metadata: { doctorCode: doctor.doctorCode }
  });
  res.status(201).json(doctor);
});

export const listDoctors = asyncHandler(async (_req, res) => {
  const doctors = await Doctor.find().populate("preferences.preferredOts", "otCode");
  res.json(doctors);
});

export const createPatient = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (!payload.mrn) payload.mrn = `MRN-${Date.now()}`;
  const patient = await Patient.create(payload);
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "CREATE_PATIENT",
    entityType: "Patient",
    entityId: String(patient._id)
  });
  res.status(201).json(patient);
});

export const listPatients = asyncHandler(async (_req, res) => {
  const patients = await Patient.find();
  res.json(patients);
});

export const createOt = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  payload.inventory = mergeInventoryWithBaseline(payload.inventory);
  const ot = await OperationTheater.create(payload);
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "CREATE_OT",
    entityType: "OperationTheater",
    entityId: String(ot._id)
  });
  res.status(201).json(ot);
});

export const listOts = asyncHandler(async (_req, res) => {
  const ots = await OperationTheater.find();
  res.json(ots);
});

export const getOtSchedule = asyncHandler(async (req, res) => {
  const ot = await OperationTheater.findById(req.params.id).select("otCode roomName");
  if (!ot) throw new ApiError(404, "OT not found");

  const ref = req.query.date ? new Date(req.query.date) : new Date();
  const dayStart = new Date(ref);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(ref);
  dayEnd.setHours(23, 59, 59, 999);

  const bookings = await Procedure.find({
    otRoomId: ot._id,
    "schedule.plannedStartTime": { $lte: dayEnd },
    "schedule.plannedEndTime": { $gte: dayStart },
    status: { $nin: ["Cancelled"] }
  })
    .populate("patientId", "name patientCode")
    .populate("team.surgeon", "name doctorCode")
    .sort({ "schedule.plannedStartTime": 1 })
    .select("caseId title procedureType status roomStatus schedule patientId team");

  res.json({
    otId: ot._id,
    otCode: ot.otCode,
    roomName: ot.roomName || "",
    date: dayStart,
    bookings
  });
});

export const applyGeneralInventoryToAllOts = asyncHandler(async (req, res) => {
  const force = Boolean(req.body?.force);
  const ots = await OperationTheater.find({});
  let updated = 0;

  for (const ot of ots) {
    const before = ot.inventory instanceof Map ? ot.inventory : new Map(Object.entries(ot.inventory || {}));
    const merged = mergeInventoryWithBaseline(before, force);
    const changed = JSON.stringify(Object.fromEntries(before.entries())) !== JSON.stringify(Object.fromEntries(merged.entries()));
    if (!changed) continue;
    ot.inventory = merged;
    await ot.save();
    updated += 1;
  }

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "APPLY_GENERAL_OT_INVENTORY",
    entityType: "OperationTheater",
    entityId: "bulk",
    metadata: { updated, force, baselineItems: Object.keys(GENERAL_OT_BASELINE_INVENTORY).length }
  });

  res.json({
    updated,
    total: ots.length,
    force,
    baseline: GENERAL_OT_BASELINE_INVENTORY
  });
});

export const updateOt = asyncHandler(async (req, res) => {
  const ot = await OperationTheater.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!ot) throw new ApiError(404, "OT not found");
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "UPDATE_OT",
    entityType: "OperationTheater",
    entityId: String(ot._id)
  });
  res.json(ot);
});

export const addOtMaintenanceBlock = asyncHandler(async (req, res) => {
  const ot = await OperationTheater.findById(req.params.id);
  if (!ot) throw new ApiError(404, "OT not found");

  const { startTime, endTime, reason } = req.body;
  if (!startTime || !endTime) throw new ApiError(400, "startTime and endTime are required");
  if (new Date(endTime) <= new Date(startTime)) throw new ApiError(400, "endTime must be after startTime");

  ot.maintenanceBlocks.push({
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    reason: reason || "",
    active: true
  });
  await ot.save();

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "ADD_OT_MAINTENANCE",
    entityType: "OperationTheater",
    entityId: String(ot._id),
    metadata: { startTime, endTime, reason: reason || "" }
  });

  res.status(201).json(ot.maintenanceBlocks[ot.maintenanceBlocks.length - 1]);
});

export const createPersonnel = asyncHandler(async (req, res) => {
  const personnel = await Personnel.create(req.body);
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "CREATE_PERSONNEL",
    entityType: "Personnel",
    entityId: String(personnel._id),
    metadata: { staffCode: personnel.staffCode, role: personnel.role }
  });
  res.status(201).json(personnel);
});

export const listPersonnel = asyncHandler(async (_req, res) => {
  const items = await Personnel.find({ active: true }).sort({ role: 1, name: 1 });
  res.json(items);
});

export const updatePersonnel = asyncHandler(async (req, res) => {
  const personnel = await Personnel.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!personnel) throw new ApiError(404, "Personnel not found");
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "UPDATE_PERSONNEL",
    entityType: "Personnel",
    entityId: String(personnel._id)
  });
  res.json(personnel);
});

export const updateDoctor = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!doctor) throw new ApiError(404, "Doctor not found");
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "UPDATE_DOCTOR",
    entityType: "Doctor",
    entityId: String(doctor._id)
  });
  res.json(doctor);
});

export const updatePatient = asyncHandler(async (req, res) => {
  const patient = await Patient.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!patient) throw new ApiError(404, "Patient not found");
  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "UPDATE_PATIENT",
    entityType: "Patient",
    entityId: String(patient._id)
  });
  res.json(patient);
});

export const listAuditLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
  const logs = await AuditLog.find({})
    .populate("actorId", "name email role")
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json(logs);
});

export const listAlerts = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
  const alerts = await Alert.find({})
    .populate("resolvedBy", "name email")
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json(alerts);
});

export const resolveAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findById(req.params.id);
  if (!alert) throw new ApiError(404, "Alert not found");

  alert.resolved = true;
  alert.resolvedAt = new Date();
  alert.resolvedBy = req.user.id;
  await alert.save();

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "RESOLVE_ALERT",
    entityType: "Alert",
    entityId: String(alert._id)
  });

  res.json(alert);
});

export const listMobileEquipment = asyncHandler(async (_req, res) => {
  const items = await MobileEquipment.find({ active: true }).sort({ name: 1 });
  res.json(items);
});

export const upsertMobileEquipment = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const quantity = Number(req.body.quantity ?? 0);
  if (!name) throw new ApiError(400, "name is required");
  if (!Number.isFinite(quantity) || quantity < 0) throw new ApiError(400, "quantity must be >= 0");

  const item = await MobileEquipment.findOneAndUpdate(
    { name },
    { name, quantity, notes: String(req.body.notes || ""), active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "UPSERT_MOBILE_EQUIPMENT",
    entityType: "MobileEquipment",
    entityId: String(item._id)
  });

  res.status(201).json(item);
});

export const updateMobileEquipment = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (payload.quantity !== undefined) {
    const qty = Number(payload.quantity);
    if (!Number.isFinite(qty) || qty < 0) throw new ApiError(400, "quantity must be >= 0");
    payload.quantity = qty;
  }

  const item = await MobileEquipment.findByIdAndUpdate(req.params.id, payload, { new: true });
  if (!item) throw new ApiError(404, "Mobile equipment item not found");

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "UPDATE_MOBILE_EQUIPMENT",
    entityType: "MobileEquipment",
    entityId: String(item._id)
  });

  res.json(item);
});
