import dayjs from "dayjs";
import Procedure from "../models/Procedure.js";
import Doctor from "../models/Doctor.js";
import OperationTheater from "../models/OperationTheater.js";
import Personnel from "../models/Personnel.js";
import MobileEquipment from "../models/MobileEquipment.js";
import { ApiError } from "../utils/ApiError.js";

const BUFFER_MINUTES = 20;
const FATIGUE_THRESHOLD_HOURS = 48;
const EQUIPMENT_OCCUPYING_STATUSES = ["Pre-Op", "In-Progress", "Recovery", "Cleaning", "Delayed"];
const MATERIAL_NAME_ALIASES = {
  "harmonic scalpel": "Harmonic Scalpel Unit",
  "harmonic scalpel unit": "Harmonic Scalpel Unit",
  "titanium mesh": "Titanium Mesh",
  "c-arm": "Mobile C-Arm (X-Ray)",
  "c arm": "Mobile C-Arm (X-Ray)",
  "x-ray": "Mobile C-Arm (X-Ray)",
  "zimmer biomet persona knee system": "Knee Prosthesis Set",
  "zimmer biomet persona knee system size 4": "Knee Prosthesis Set",
  "persona knee system": "Knee Prosthesis Set",
  "knee prosthesis": "Knee Prosthesis Set"
};

function asDate(value, label) {
  const dt = dayjs(value);
  if (!dt.isValid()) throw new ApiError(400, `Invalid ${label}`);
  return dt;
}

function overlapFilter(start, end, procedureId = null) {
  return {
    _id: { $ne: procedureId },
    status: { $nin: ["Cancelled", "Completed"] },
    "schedule.plannedStartTime": { $lt: end.toDate() },
    "schedule.plannedEndTime": { $gt: start.toDate() }
  };
}

function parseShiftToMinutes(timeStr, fallback) {
  const value = String(timeStr || fallback || "00:00");
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m));
}

function isWithinShift(start, end, shiftStart, shiftEnd) {
  const startM = start.hour() * 60 + start.minute();
  const endM = end.hour() * 60 + end.minute();
  const shiftStartM = parseShiftToMinutes(shiftStart, "00:00");
  const shiftEndM = parseShiftToMinutes(shiftEnd, "23:59");
  return startM >= shiftStartM && endM <= shiftEndM;
}

function intersects(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function roomSizeRank(value) {
  const v = normalizeText(value);
  if (v.includes("large")) return 3;
  if (v.includes("medium")) return 2;
  if (v.includes("small")) return 1;
  return 0;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textMatch(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const sa = new Set(na.split(/\s+/).filter(Boolean));
  const sb = new Set(nb.split(/\s+/).filter(Boolean));
  const hits = Array.from(sb).filter((t) => sa.has(t)).length;
  return hits >= Math.max(1, Math.ceil(sb.size * 0.5));
}

function isProvidedByOtInfrastructure(ot, materialName) {
  const corpus = [
    ...(ot.fixedInfrastructure || []),
    ...(ot.capabilities || []),
    ...(ot.primarySpecialization || []),
    ot.functionality || ""
  ];
  return corpus.some((entry) => textMatch(entry, materialName));
}

function cleanMaterials(materials = []) {
  const normalized = new Map();
  const canonicalize = (value) => {
    const raw = String(value || "").trim();
    const rawLower = raw.toLowerCase();
    const rawFlat = rawLower.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
    if (MATERIAL_NAME_ALIASES[rawLower]) return MATERIAL_NAME_ALIASES[rawLower];
    if (MATERIAL_NAME_ALIASES[rawFlat]) return MATERIAL_NAME_ALIASES[rawFlat];
    if (rawLower.includes("zimmer biomet persona knee system")) return "Knee Prosthesis Set";
    return raw;
  };
  const entries = materials
    .filter((item) => item?.name)
    .map((item) => ({
      name: (() => {
        return canonicalize(item.name);
      })(),
      quantity: Number(item.quantity || 1),
      consumed: Number(item.consumed || 0)
    }));

  for (const item of entries) {
    const prev = normalized.get(item.name);
    if (prev) {
      prev.quantity += item.quantity;
      prev.consumed += item.consumed;
    } else {
      normalized.set(item.name, { ...item });
    }
  }
  return Array.from(normalized.values());
}

async function computeMaterialUsage({ otRoomId, materials, procedureId }) {
  if (!materials.length) return;

  const ot = await OperationTheater.findById(otRoomId);
  if (!ot) throw new ApiError(404, "OT not found");

  const inventory = ot.inventory || new Map();
  const inventoryEntries = Array.from(inventory.entries());
  const occupiedInRoom = await Procedure.find({
    _id: { $ne: procedureId },
    status: { $in: EQUIPMENT_OCCUPYING_STATUSES },
    otRoomId
  }).select("resources.materials");
  const occupiedGlobal = await Procedure.find({
    _id: { $ne: procedureId },
    status: { $in: EQUIPMENT_OCCUPYING_STATUSES }
  }).select("resources.materials");
  const mobilePool = await MobileEquipment.find({ active: true }).select("name quantity");

  for (const material of materials) {
    if (!Number.isFinite(material.quantity) || material.quantity < 1) {
      throw new ApiError(400, `Invalid quantity for material: ${material.name}`);
    }

    // If this requirement is natively provided by OT's fixed infra/capability DNA,
    // don't force inventory/mobile stock for scheduling confirmation.
    if (isProvidedByOtInfrastructure(ot, material.name)) {
      continue;
    }

    const stock = inventoryEntries.reduce((sum, [stockName, qtyRaw]) => {
      if (!textMatch(stockName, material.name)) return sum;
      return sum + Number(qtyRaw || 0);
    }, 0);
    const occupiedRoomQty = occupiedInRoom.reduce((sum, proc) => {
      const matchedQty = (proc.resources?.materials || []).reduce((inner, entry) => {
        if (!textMatch(entry?.name, material.name)) return inner;
        return inner + Number(entry?.quantity || 0);
      }, 0);
      return sum + matchedQty;
    }, 0);

    if (stock - occupiedRoomQty - material.quantity >= 0) {
      continue;
    }

    // Fallback to shared mobile pool if OT inventory cannot satisfy this item.
    const mobileStock = mobilePool.reduce((sum, item) => {
      if (!textMatch(item?.name, material.name)) return sum;
      return sum + Number(item?.quantity || 0);
    }, 0);
    const occupiedGlobalQty = occupiedGlobal.reduce((sum, proc) => {
      const matchedQty = (proc.resources?.materials || []).reduce((inner, entry) => {
        if (!textMatch(entry?.name, material.name)) return inner;
        return inner + Number(entry?.quantity || 0);
      }, 0);
      return sum + matchedQty;
    }, 0);

    if (mobileStock - occupiedGlobalQty - material.quantity < 0) {
      throw new ApiError(409, `Material/equipment currently occupied or unavailable: ${material.name}`);
    }
  }
}

export async function getDoctorWeeklyLoadHours(doctorId, dateRef, procedureId = null) {
  const target = dayjs(dateRef);
  const weekStart = target.startOf("week").toDate();
  const weekEnd = target.endOf("week").toDate();

  const docs = await Procedure.find({
    _id: { $ne: procedureId },
    "team.surgeon": doctorId,
    status: { $nin: ["Cancelled"] },
    "schedule.plannedStartTime": { $gte: weekStart },
    "schedule.plannedEndTime": { $lte: weekEnd }
  }).select("schedule.plannedStartTime schedule.plannedEndTime");

  return docs.reduce((sum, item) => {
    const minutes = dayjs(item.schedule.plannedEndTime).diff(dayjs(item.schedule.plannedStartTime), "minute");
    return sum + minutes / 60;
  }, 0);
}

async function buildAiDelayHint(surgeonId, otRoomId) {
  const delayedCount = await Procedure.countDocuments({
    "team.surgeon": surgeonId,
    status: "Delayed",
    updatedAt: { $gte: dayjs().subtract(30, "day").toDate() }
  });
  const otDelayed = await Procedure.countDocuments({
    otRoomId,
    status: "Delayed",
    updatedAt: { $gte: dayjs().subtract(30, "day").toDate() }
  });

  if (delayedCount >= 3 || otDelayed >= 5) {
    return "Predictive Delay AI: High recent delay trend detected. Consider +15 mins turnover buffer.";
  }
  return "";
}

async function applySurgeonMaterialTemplate({ surgeonId, procedureType, resources }) {
  const surgeon = await Doctor.findById(surgeonId).select("preferences.materialTemplates");
  if (!surgeon?.preferences?.materialTemplates?.length) return resources;

  const template = surgeon.preferences.materialTemplates.find(
    (item) => String(item.procedureType || "").toLowerCase() === String(procedureType || "").toLowerCase()
  );
  if (!template) return resources;

  const existingNames = new Set((resources.materials || []).map((m) => m.name));
  const merged = [...(resources.materials || [])];
  for (const material of template.materials || []) {
    if (!existingNames.has(material.name)) {
      merged.push({ name: material.name, quantity: Number(material.quantity || 1), consumed: 0 });
    }
  }

  return {
    ...resources,
    materials: merged
  };
}

export async function validateSchedule(payload, options = {}) {
  const {
    procedureId = null,
    allowEmergencyPreempt = false,
    forceScheduleConflicts = false,
    forceConflictOverrides = []
  } = options;
  const warnings = [];
  const forceSet = new Set(
    (Array.isArray(forceConflictOverrides) ? forceConflictOverrides : [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const canForce = (type) => forceScheduleConflicts || forceSet.has(type);

  const start = asDate(payload?.schedule?.startTime, "schedule.startTime");
  const end = asDate(payload?.schedule?.endTime, "schedule.endTime");
  if (!end.isAfter(start)) throw new ApiError(400, "End time must be after start time");

  const bufferEnd = end.add(BUFFER_MINUTES, "minute");
  const emergencyMode = allowEmergencyPreempt && payload.priority === "Emergency";

  if (payload?.team?.anesthesiaType === "General" && !payload?.schedule?.anesthesiaPrepTimestamp) {
    throw new ApiError(400, "General anesthesia requires anesthesia prep timestamp");
  }

  if (payload?.schedule?.anesthesiaPrepTimestamp) {
    const prep = asDate(payload.schedule.anesthesiaPrepTimestamp, "schedule.anesthesiaPrepTimestamp");
    if (!prep.isBefore(start)) {
      throw new ApiError(400, "Anesthesia prep timestamp must be before start time");
    }
  }

  const otConflictFilter = {
    _id: { $ne: procedureId },
    otRoomId: payload.otRoomId,
    status: { $nin: ["Cancelled", "Completed"] },
    "schedule.plannedStartTime": { $lt: bufferEnd.toDate() },
    "schedule.bufferEndTime": { $gt: start.toDate() }
  };

  const personnelOverlap = overlapFilter(start, end, procedureId);
  const [otConflict, surgeonConflict, assistantConflict, anesthesiologistConflicts, doctor, otRecord] = await Promise.all([
    Procedure.findOne(otConflictFilter),
    Procedure.findOne({ ...personnelOverlap, "team.surgeon": payload.team.surgeon }),
    payload.team.assistantMedic
      ? Procedure.findOne({ ...personnelOverlap, "team.assistantMedic": payload.team.assistantMedic })
      : null,
    Procedure.find({ ...personnelOverlap, "team.anesthesiologist": payload.team.anesthesiologist })
      .select("caseId schedule.plannedStartTime schedule.plannedEndTime schedule.anesthesiaReleasedAt"),
    Doctor.findById(payload.team.surgeon),
    OperationTheater.findById(payload.otRoomId)
  ]);

  const nurseIds = Array.isArray(payload.team.nurses) ? payload.team.nurses.filter(Boolean) : [];
  const [nurseConflict, anesthesiologist, validNurseCount] = await Promise.all([
    nurseIds.length ? Procedure.findOne({ ...personnelOverlap, "team.nurses": { $in: nurseIds } }) : null,
    Personnel.findOne({ _id: payload.team.anesthesiologist, role: "Anesthesiologist", active: true }),
    nurseIds.length ? Personnel.countDocuments({ _id: { $in: nurseIds }, role: "Nurse", active: true }) : 0
  ]);

  if (!doctor) throw new ApiError(404, "Surgeon not found");
  if (!otRecord) throw new ApiError(404, "OT not found");

  const envReq = payload?.resources?.environmentRequirements || {};
  if (envReq.requiredHvac) {
    const hvacMatch = textMatch(otRecord.hvacClass, envReq.requiredHvac) || 
                      isProvidedByOtInfrastructure(otRecord, envReq.requiredHvac);
    if (!hvacMatch) {
      throw new ApiError(409, `OT HVAC mismatch. Required: ${envReq.requiredHvac}`);
    }
  }


  const maintenanceBlocks = Array.isArray(otRecord.maintenanceBlocks) ? otRecord.maintenanceBlocks : [];
  const inMaintenance = maintenanceBlocks.find(
    (block) =>
      block?.active && intersects(start.toDate(), bufferEnd.toDate(), new Date(block.startTime), new Date(block.endTime))
  );
  if (inMaintenance) {
    throw new ApiError(409, `OT unavailable due maintenance: ${inMaintenance.reason || "Maintenance block"}`);
  }

  if (otConflict && !emergencyMode && !canForce("ot")) {
    throw new ApiError(409, "OT has overlapping procedure", {
      conflictType: "ot",
      conflictCaseId: otConflict.caseId || ""
    });
  }
  if (surgeonConflict && !canForce("surgeon")) {
    throw new ApiError(409, "Surgeon has overlapping procedure", {
      conflictType: "surgeon",
      conflictCaseId: surgeonConflict.caseId || ""
    });
  }
  if (assistantConflict && !canForce("assistant")) {
    throw new ApiError(409, "Assistant has overlapping procedure", {
      conflictType: "assistant",
      conflictCaseId: assistantConflict.caseId || ""
    });
  }
  const anesthesiologistConflict = anesthesiologistConflicts.find((item) => {
    const releasedAt = item.schedule?.anesthesiaReleasedAt ? dayjs(item.schedule.anesthesiaReleasedAt) : null;
    if (!releasedAt || !releasedAt.isValid()) return true;
    return releasedAt.isAfter(start);
  });
  if (anesthesiologistConflict && !canForce("anesthesiologist")) {
    throw new ApiError(409, "Anesthesiologist has overlapping procedure", {
      conflictType: "anesthesiologist",
      conflictCaseId: anesthesiologistConflict.caseId || ""
    });
  }
  if (nurseConflict && !canForce("nurse")) {
    throw new ApiError(409, "Nurse has overlapping procedure", {
      conflictType: "nurse",
      conflictCaseId: nurseConflict.caseId || ""
    });
  }
  if (!anesthesiologist) throw new ApiError(400, "Selected anesthesiologist is invalid or inactive");
  if (nurseIds.length && validNurseCount !== nurseIds.length) {
    throw new ApiError(400, "One or more selected nurses are invalid or inactive");
  }

  if (!isWithinShift(start, end, anesthesiologist.shiftStart, anesthesiologist.shiftEnd)) {
    throw new ApiError(409, "Selected anesthesiologist is outside shift window");
  }

  if (nurseIds.length) {
    const nurseDocs = await Personnel.find({ _id: { $in: nurseIds }, role: "Nurse", active: true });
    const outsideShift = nurseDocs.find((nurse) => !isWithinShift(start, end, nurse.shiftStart, nurse.shiftEnd));
    if (outsideShift) {
      throw new ApiError(409, `Nurse outside shift window: ${outsideShift.name}`);
    }
  }

  let materials = cleanMaterials(payload?.resources?.materials);
  const resourcesWithTemplates = await applySurgeonMaterialTemplate({
    surgeonId: payload.team.surgeon,
    procedureType: payload.procedureType,
    resources: { ...(payload.resources || {}), materials }
  });
  materials = cleanMaterials(resourcesWithTemplates.materials || []);

  await computeMaterialUsage({ otRoomId: payload.otRoomId, materials, start, end, procedureId });

  const weeklyLoad = await getDoctorWeeklyLoadHours(payload.team.surgeon, start.toDate(), procedureId);
  const plannedHours = end.diff(start, "minute") / 60;
  const totalHours = weeklyLoad + plannedHours;

  if (totalHours > Math.min(Number(doctor.maxHoursPerWeek || FATIGUE_THRESHOLD_HOURS), FATIGUE_THRESHOLD_HOURS)) {
    warnings.push(`Fatigue alert: weekly load projected at ${totalHours.toFixed(1)}h for surgeon ${doctor.name}.`);
  }

  return {
    normalized: {
      ...payload,
      resources: {
        ...resourcesWithTemplates,
        materials
      },
      schedule: {
        date: start.startOf("day").toDate(),
        plannedStartTime: start.toDate(),
        plannedEndTime: end.toDate(),
        bufferEndTime: bufferEnd.toDate(),
        estimatedDurationMinutes: end.diff(start, "minute"),
        estimatedFinishTime: end.toDate(),
        anesthesiaPrepTimestamp: payload?.schedule?.anesthesiaPrepTimestamp || null
      }
    },
    warnings,
    aiRecommendation: await buildAiDelayHint(payload.team.surgeon, payload.otRoomId)
  };
}

export async function forcePostponeConflictingProcedures({
  procedure,
  actorId,
  reason = "Force Schedule",
  conflictTypes = ["ot", "surgeon", "assistant", "anesthesiologist", "nurse"]
}) {
  if (!procedure?._id) return [];

  const start = dayjs(procedure.schedule?.plannedStartTime);
  const end = dayjs(procedure.schedule?.plannedEndTime);
  if (!start.isValid() || !end.isValid()) return [];

  const overlap = overlapFilter(start, end, procedure._id);
  const nurseIds = Array.isArray(procedure.team?.nurses) ? procedure.team.nurses.filter(Boolean) : [];
  const conflictSet = new Set(
    (Array.isArray(conflictTypes) ? conflictTypes : [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const conflictClauses = [];
  if (conflictSet.has("ot")) conflictClauses.push({ otRoomId: procedure.otRoomId });
  if (conflictSet.has("surgeon")) conflictClauses.push({ "team.surgeon": procedure.team?.surgeon });
  if (conflictSet.has("assistant") && procedure.team?.assistantMedic) conflictClauses.push({ "team.assistantMedic": procedure.team.assistantMedic });
  if (conflictSet.has("anesthesiologist")) conflictClauses.push({ "team.anesthesiologist": procedure.team?.anesthesiologist });
  if (conflictSet.has("nurse") && nurseIds.length) conflictClauses.push({ "team.nurses": { $in: nurseIds } });
  if (!conflictClauses.length) return [];

  const conflicts = await Procedure.find({
    ...overlap,
    $or: conflictClauses
  }).sort({ "schedule.plannedStartTime": 1 });

  const shiftMinutes = Number(procedure.schedule?.estimatedDurationMinutes || end.diff(start, "minute")) + BUFFER_MINUTES;
  const affected = [];

  for (const item of conflicts) {
    item.schedule.plannedStartTime = dayjs(item.schedule.plannedStartTime).add(shiftMinutes, "minute").toDate();
    item.schedule.plannedEndTime = dayjs(item.schedule.plannedEndTime).add(shiftMinutes, "minute").toDate();
    item.schedule.bufferEndTime = dayjs(item.schedule.bufferEndTime).add(shiftMinutes, "minute").toDate();
    item.schedule.estimatedFinishTime = dayjs(item.schedule.estimatedFinishTime || item.schedule.plannedEndTime)
      .add(shiftMinutes, "minute")
      .toDate();
    item.status = "Postponed";
    item.delayLogs.push({
      reason: "Other",
      note: `${reason}: auto postponed by ${shiftMinutes} mins due ${procedure.caseId}`,
      loggedBy: actorId
    });
    item.statusHistory.push({
      status: "Postponed",
      note: `Auto postponed by ${shiftMinutes} mins due force schedule for ${procedure.caseId}`,
      changedBy: actorId
    });
    await item.save();

    affected.push({
      procedureId: String(item._id),
      caseId: item.caseId,
      shiftMinutes,
      surgeonId: String(item.team?.surgeon || ""),
      anesthesiologistId: String(item.team?.anesthesiologist || ""),
      nurseIds: (item.team?.nurses || []).map((n) => String(n))
    });
  }

  return affected;
}

export async function rippleShiftSchedules({
  otRoomId,
  fromTime,
  shiftMinutes,
  actorId,
  reason = "Emergency Bump",
  ignoreProcedureId = null,
  skipEmergency = false
}) {
  if (shiftMinutes <= 0) return [];
  const from = new Date(fromTime);

  const filter = {
    otRoomId,
    status: { $nin: ["Cancelled", "Completed"] },
    "schedule.plannedStartTime": { $gte: from }
  };
  if (ignoreProcedureId) {
    filter._id = { $ne: ignoreProcedureId };
  }
  if (skipEmergency) {
    filter.priority = { $ne: "Emergency" };
  }

  const affected = await Procedure.find({
    ...filter
  }).sort({ "schedule.plannedStartTime": 1 });

  const shifted = [];
  for (const item of affected) {
    const previousOtId = String(item.otRoomId || "");
    const previousStart = item.schedule.plannedStartTime;
    const previousEnd = item.schedule.plannedEndTime;

    let action = "postponed";
    let movedToOtId = null;
    let movedToOtCode = "";
    const options = await getReassignmentOptions(item);
    const alternativeOt = (options?.otRooms || []).find((ot) => String(ot._id) !== previousOtId);

    if (alternativeOt) {
      item.otRoomId = alternativeOt._id;
      action = "moved";
      movedToOtId = String(alternativeOt._id);
      movedToOtCode = alternativeOt.otCode || "";
      item.statusHistory.push({
        status: item.status,
        note: `Moved to ${movedToOtCode || "alternate OT"} due emergency bump`,
        changedBy: actorId
      });
    } else {
      item.schedule.plannedStartTime = dayjs(item.schedule.plannedStartTime).add(shiftMinutes, "minute").toDate();
      item.schedule.plannedEndTime = dayjs(item.schedule.plannedEndTime).add(shiftMinutes, "minute").toDate();
      item.schedule.bufferEndTime = dayjs(item.schedule.bufferEndTime).add(shiftMinutes, "minute").toDate();
      item.schedule.estimatedFinishTime = dayjs(item.schedule.estimatedFinishTime || item.schedule.plannedEndTime)
        .add(shiftMinutes, "minute")
        .toDate();
      item.status = "Postponed";
      item.delayLogs.push({ reason: reason === "Emergency Bump" ? "Emergency Bump" : "Other", note: `Auto shift +${shiftMinutes} mins`, loggedBy: actorId });
      item.statusHistory.push({ status: "Postponed", note: `Auto shifted by ${shiftMinutes} mins`, changedBy: actorId });
    }

    item.arrangement = {
      ...(item.arrangement || {}),
      requiresSurgeonAck: true,
      surgeonAckStatus: "Pending",
      changeRequestReason: "",
      changeRequestedAt: null
    };
    item.statusHistory.push({
      status: item.status,
      note: "Awaiting surgeon acknowledgment for emergency arrangement",
      changedBy: actorId
    });

    await item.save();
    shifted.push({
      id: item._id,
      caseId: item.caseId,
      action,
      shiftMinutes: action === "postponed" ? shiftMinutes : 0,
      previousOtId,
      movedToOtId,
      movedToOtCode,
      previousStart,
      previousEnd,
      newStart: item.schedule.plannedStartTime,
      newEnd: item.schedule.plannedEndTime,
      surgeonId: String(item.team?.surgeon || ""),
      anesthesiologistId: String(item.team?.anesthesiologist || ""),
      nurseIds: (item.team?.nurses || []).map((n) => String(n))
    });
  }

  return shifted;
}

export async function getOtAnalytics({ startDate, endDate }) {
  const match = {};
  if (startDate || endDate) {
    match["schedule.plannedStartTime"] = {};
    if (startDate) match["schedule.plannedStartTime"].$gte = new Date(startDate);
    if (endDate) match["schedule.plannedStartTime"].$lte = new Date(endDate);
  }

  return Procedure.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$otRoomId",
        totalCases: { $sum: 1 },
        emergencyCases: { $sum: { $cond: [{ $eq: ["$priority", "Emergency"] }, 1, 0] } },
        completedCases: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        avgPlanned: { $avg: "$schedule.estimatedDurationMinutes" },
        avgActual: { $avg: "$schedule.actualDurationMinutes" }
      }
    }
  ]);
}

export async function getEfficiencyHeatmap({ date }) {
  const day = dayjs(date || new Date());
  const start = day.startOf("day").toDate();
  const end = day.endOf("day").toDate();
  const ots = await OperationTheater.find({ active: true }).select("otCode");

  const procedures = await Procedure.find({
    "schedule.plannedStartTime": { $lte: end },
    "schedule.plannedEndTime": { $gte: start },
    status: { $nin: ["Cancelled"] }
  }).select("otRoomId schedule");

  return ots.map((ot) => {
    const rows = procedures.filter((p) => String(p.otRoomId) === String(ot._id));
    const usedMinutes = rows.reduce((sum, p) => {
      const s = dayjs(p.schedule.plannedStartTime);
      const e = dayjs(p.schedule.plannedEndTime);
      return sum + Math.max(0, e.diff(s, "minute"));
    }, 0);

    return {
      otId: ot._id,
      otCode: ot.otCode,
      utilizationPercent: Number(((usedMinutes / (24 * 60)) * 100).toFixed(2))
    };
  });
}

export async function getReassignmentOptions(procedure) {
  const start = dayjs(procedure.schedule.plannedStartTime);
  const end = dayjs(procedure.schedule.plannedEndTime);
  const overlap = overlapFilter(start, end, procedure._id);

  const [allDoctors, allAnes, allNurses, allOts, conflicting] = await Promise.all([
    Doctor.find({ active: true }).select("doctorCode name specialization"),
    Personnel.find({ role: "Anesthesiologist", active: true }).select("staffCode name shiftStart shiftEnd"),
    Personnel.find({ role: "Nurse", active: true }).select("staffCode name shiftStart shiftEnd"),
    OperationTheater.find({ active: true }).select("otCode maintenanceBlocks"),
    Procedure.find({ ...overlap }).select("otRoomId team")
  ]);

  const usedDoctorIds = new Set(conflicting.flatMap((item) => [item.team?.surgeon, item.team?.assistantMedic]).filter(Boolean).map(String));
  const usedAnesIds = new Set(conflicting.map((item) => item.team?.anesthesiologist).filter(Boolean).map(String));
  const usedNurseIds = new Set(conflicting.flatMap((item) => item.team?.nurses || []).map(String));
  const usedOtIds = new Set(conflicting.map((item) => item.otRoomId).filter(Boolean).map(String));

  const surgeons = allDoctors.filter((d) => !usedDoctorIds.has(String(d._id))).slice(0, 8);
  const assistants = allDoctors.filter((d) => !usedDoctorIds.has(String(d._id))).slice(0, 8);
  const anesthesiologists = allAnes
    .filter((a) => !usedAnesIds.has(String(a._id)) && isWithinShift(start, end, a.shiftStart, a.shiftEnd))
    .slice(0, 8);
  const nurses = allNurses
    .filter((n) => !usedNurseIds.has(String(n._id)) && isWithinShift(start, end, n.shiftStart, n.shiftEnd))
    .slice(0, 12);
  const otRooms = allOts
    .filter((ot) => {
      if (usedOtIds.has(String(ot._id))) return false;
      return !(ot.maintenanceBlocks || []).some((block) => block?.active && intersects(start.toDate(), end.add(BUFFER_MINUTES, "minute").toDate(), new Date(block.startTime), new Date(block.endTime)));
    })
    .slice(0, 6);

  return { surgeons, assistants, anesthesiologists, nurses, otRooms };
}

export async function getResourceCalendar({ date }) {
  const day = dayjs(date || new Date());
  const start = day.startOf("day").toDate();
  const end = day.endOf("day").toDate();

  const [procedures, ots] = await Promise.all([
    Procedure.find({
      "schedule.plannedStartTime": { $lte: end },
      "schedule.plannedEndTime": { $gte: start },
      status: { $nin: ["Cancelled"] }
    }).populate("otRoomId", "otCode"),
    OperationTheater.find({ active: true }).select("otCode inventory maintenanceBlocks")
  ]);

  return ots.map((ot) => {
    const bookings = procedures
      .filter((proc) => String(proc.otRoomId?._id) === String(ot._id))
      .map((proc) => ({
        caseId: proc.caseId,
        procedureCode: proc.procedureCode,
        startTime: proc.schedule.plannedStartTime,
        endTime: proc.schedule.plannedEndTime,
        materials: proc.resources?.materials || []
      }));

    return {
      otId: ot._id,
      otCode: ot.otCode,
      inventory: Object.fromEntries((ot.inventory || new Map()).entries()),
      maintenanceBlocks: (ot.maintenanceBlocks || []).filter((block) => block?.active && intersects(start, end, new Date(block.startTime), new Date(block.endTime))),
      bookings
    };
  });
}
