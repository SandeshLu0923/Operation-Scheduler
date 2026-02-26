import dayjs from "dayjs";
import Procedure from "../models/Procedure.js";
import Personnel from "../models/Personnel.js";
import Patient from "../models/Patient.js";
import Doctor from "../models/Doctor.js";
import SurgeryRequest from "../models/SurgeryRequest.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import {
  forcePostponeConflictingProcedures,
  getReassignmentOptions,
  rippleShiftSchedules,
  validateSchedule
} from "../services/schedulerService.js";
import { logAction } from "../services/auditService.js";
import { buildPagination } from "../utils/pagination.js";
import { emitRealtime } from "../services/realtimeService.js";
import { createAlert } from "../services/alertService.js";
import {
  addStatusHistory,
  checklistComplete,
  ensureArrangementAcknowledged,
  ensureRole,
  isAssignedOtStaff,
  isAssignedSurgeonOrAssistant,
  normalizeProcedureBody,
  specialtyChecklistComplete,
  toId
} from "../utils/procedureHelpers.js";

function assertOtStaffAssigned(req, procedure) {
  if (req.user.role !== "ot_staff") return;
  const staffProfileId = toId(req.user.personnelProfile) || req.user.personnelProfile;
  if (!isAssignedOtStaff(procedure, staffProfileId)) {
    throw new ApiError(403, "Only assigned OT staff can access this procedure");
  }
}

async function getStaffRole(req) {
  if (req.user.role !== "ot_staff" || !req.user.personnelProfile) return "";
  const profile = await Personnel.findById(toId(req.user.personnelProfile)).select("role");
  return profile?.role || "";
}

async function emitLateFlagIfNeeded(procedure) {
  const estimated = Number(procedure.schedule?.estimatedDurationMinutes || 0);
  if (!estimated || procedure.schedule?.lateFlagSentAt) return;

  const endRef = procedure.schedule?.actualEndTime || new Date();
  const startRef = procedure.schedule?.actualStartTime || procedure.schedule?.plannedStartTime;
  const actual = dayjs(endRef).diff(dayjs(startRef), "minute");
  if (!Number.isFinite(actual) || actual <= estimated * 1.1) return;

  const nextCase = await Procedure.findOne({
    _id: { $ne: procedure._id },
    otRoomId: procedure.otRoomId,
    status: { $nin: ["Cancelled", "Completed"] },
    "schedule.plannedStartTime": { $gte: new Date() }
  })
    .sort({ "schedule.plannedStartTime": 1 })
    .populate("team.surgeon", "name");

  const msg = `Late flag: ${procedure.caseId} exceeded estimate by >10% (${actual}m vs ${estimated}m).`;
  await createAlert({
    type: "late_flag",
    severity: "high",
    message: msg,
    source: "scheduler",
    metadata: {
      procedureId: procedure._id,
      caseId: procedure.caseId,
      estimated,
      actual,
      nextCaseId: nextCase?.caseId || null,
      nextSurgeon: nextCase?.team?.surgeon?.name || null
    }
  });

  procedure.schedule.lateFlagSentAt = new Date();
  emitRealtime("alert:critical-path", {
    level: "high",
    message: `${msg}${nextCase ? ` Next queue: ${nextCase.caseId}` : ""}`
  });
}

export const createProcedure = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_admin"]);

  const payload = normalizeProcedureBody(req.body);
  const forceConflictOverrides = Array.isArray(req.body?.forceConflictOverrides)
    ? req.body.forceConflictOverrides
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
    : [];
  const forceSchedule = Boolean(req.body?.forceSchedule) || forceConflictOverrides.length > 0;
  const { normalized, warnings, aiRecommendation } = await validateSchedule(payload, {
    allowEmergencyPreempt: true,
    forceScheduleConflicts: false,
    forceConflictOverrides
  });

  const procedure = await Procedure.create({
    ...normalized,
    aiRecommendation,
    fatigueWarning: warnings.join(" "),
    status: "Scheduled",
    roomStatus: "Idle",
    createdBy: req.user.id,
    statusHistory: [{ status: "Scheduled", note: "Created", changedBy: req.user.id }]
  });

  let shifted = [];
  if (procedure.priority === "Emergency") {
    const shiftMinutes = procedure.schedule.estimatedDurationMinutes + 30;
    shifted = await rippleShiftSchedules({
      otRoomId: procedure.otRoomId,
      fromTime: procedure.schedule.plannedStartTime,
      shiftMinutes,
      actorId: req.user.id,
      reason: "Emergency Bump",
      ignoreProcedureId: procedure._id,
      skipEmergency: true
    });

    if (shifted.length) {
      const message = `Emergency ripple shift applied to ${shifted.length} schedules in same OT.`;
      await createAlert({
        type: "emergency_bump",
        severity: "critical",
        message,
        source: "scheduler",
        metadata: { caseId: procedure.caseId, shifted }
      });
      for (const item of shifted) {
        await createAlert({
          type: "surgeon_arrangement_review",
          severity: "high",
          message: item.action === "moved"
            ? `Case ${item.caseId} moved to ${item.movedToOtCode || "alternate OT"} due emergency. Surgeon acceptance required.`
            : `Case ${item.caseId} postponed by ${item.shiftMinutes} minutes due emergency. Surgeon acceptance required.`,
          source: "scheduler",
          metadata: {
            procedureId: item.id,
            caseId: item.caseId,
            surgeonId: item.surgeonId,
            action: item.action,
            previousStart: item.previousStart,
            newStart: item.newStart,
            movedToOtId: item.movedToOtId || null,
            movedToOtCode: item.movedToOtCode || null,
            notifyPersonnelIds: [item.surgeonId].filter(Boolean)
          }
        });
      }
      emitRealtime("alert:critical-path", { level: "high", message, shifted });
    }
  }

  let forcePostponed = [];
  if (forceSchedule && procedure.status === "Scheduled") {
    forcePostponed = await forcePostponeConflictingProcedures({
      procedure,
      actorId: req.user.id,
      reason: "Force Schedule",
      conflictTypes: forceConflictOverrides.length
        ? forceConflictOverrides
        : ["ot", "surgeon", "assistant", "anesthesiologist", "nurse"]
    });
    for (const impacted of forcePostponed) {
      const notifyPersonnelIds = [
        impacted.surgeonId,
        impacted.anesthesiologistId,
        ...impacted.nurseIds
      ].filter(Boolean);
      await createAlert({
        type: "force_schedule_postponed",
        severity: "high",
        message: `Case ${impacted.caseId} postponed by ${impacted.shiftMinutes} mins due force scheduling of ${procedure.caseId}.`,
        source: "admin",
        metadata: {
          procedureId: impacted.procedureId,
          caseId: impacted.caseId,
          shiftMinutes: impacted.shiftMinutes,
          triggeredByCaseId: procedure.caseId,
          notifyPersonnelIds
        }
      });
      emitRealtime("alert:critical-path", {
        level: "high",
        message: `Force schedule: ${impacted.caseId} postponed by ${impacted.shiftMinutes} mins due ${procedure.caseId}.`,
        caseId: impacted.caseId,
        notifyPersonnelIds
      });
    }
  }

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "CREATE_PROCEDURE",
    entityType: "Procedure",
    entityId: String(procedure._id),
    metadata: { caseId: procedure.caseId, warnings }
  });

  emitRealtime("procedure:created", { caseId: procedure.caseId, status: procedure.status, shifted, otRoomId: procedure.otRoomId });

  res.status(201).json({ procedure, warnings, shifted, forcePostponed, aiRecommendation });
});

export const listProcedures = asyncHandler(async (req, res) => {
  const { page, limit, skip } = buildPagination(req.query);
  const filter = {};

  if (req.query.status) filter.status = req.query.status;
  if (req.query.priority) filter.priority = req.query.priority;

  if (req.query.dateFrom || req.query.dateTo) {
    filter["schedule.plannedStartTime"] = {};
    if (req.query.dateFrom) filter["schedule.plannedStartTime"].$gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) filter["schedule.plannedStartTime"].$lte = new Date(req.query.dateTo);
  }

  if (req.user.role === "surgeon" && req.user.doctorProfile) {
    const doctorProfileId = toId(req.user.doctorProfile) || req.user.doctorProfile;
    filter.$or = [{ "team.surgeon": doctorProfileId }, { "team.assistantMedic": doctorProfileId }];
  }

  if (req.user.role === "ot_staff" && req.user.personnelProfile) {
    const staffProfileId = toId(req.user.personnelProfile) || req.user.personnelProfile;
    filter.$or = [{ "team.anesthesiologist": staffProfileId }, { "team.nurses": staffProfileId }];
  }
  if (req.user.role === "ot_staff" && !req.user.personnelProfile) {
    throw new ApiError(403, "Staff profile is required");
  }

  await Procedure.updateMany(
    {
      status: "Cleaning",
      turnoverEndsAt: { $lte: new Date() },
      caseLocked: false
    },
    {
      $set: { status: "Completed", roomStatus: "Idle" },
      $push: { statusHistory: { status: "Completed", note: "Auto turnover completed", changedAt: new Date() } }
    }
  );

  const [items, total] = await Promise.all([
    Procedure.find(filter)
      .populate("patientId", "patientCode name pacStatus mrn")
      .populate("team.surgeon", "doctorCode name")
      .populate("team.assistantMedic", "doctorCode name")
      .populate("team.anesthesiologist", "staffCode name")
      .populate("team.nurses", "staffCode name")
      .populate("otRoomId", "otCode")
      .sort({ "schedule.plannedStartTime": 1 })
      .skip(skip)
      .limit(limit),
    Procedure.countDocuments(filter)
  ]);

  res.json({ page, limit, total, items });
});

export const getProcedureById = asyncHandler(async (req, res) => {
  const item = await Procedure.findById(req.params.id)
    .populate("patientId")
    .populate("team.surgeon")
    .populate("team.assistantMedic")
    .populate("team.anesthesiologist")
    .populate("team.nurses")
    .populate("otRoomId")
    .populate("createdBy", "name email role");

  if (!item) throw new ApiError(404, "Procedure not found");

  if (req.user.role === "surgeon" && !isAssignedSurgeonOrAssistant(item, req.user.doctorProfile)) {
    throw new ApiError(403, "Can access only assigned surgeries");
  }
  assertOtStaffAssigned(req, item);

  res.json(item);
});

export const rescheduleProcedure = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");

  const draft = normalizeProcedureBody({ ...procedure.toObject(), ...req.body });
  const { normalized, warnings, aiRecommendation } = await validateSchedule(draft, { procedureId: procedure._id });

  procedure.otRoomId = normalized.otRoomId;
  procedure.schedule = { ...procedure.schedule, ...normalized.schedule };
  procedure.team = normalized.team;
  procedure.resources = normalized.resources;
  procedure.aiRecommendation = aiRecommendation;
  procedure.fatigueWarning = warnings.join(" ");
  addStatusHistory(procedure, "Postponed", "Rescheduled by admin", req.user.id);
  await procedure.save();

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "RESCHEDULE_PROCEDURE",
    entityType: "Procedure",
    entityId: String(procedure._id),
    metadata: { warnings }
  });

  emitRealtime("procedure:updated", { caseId: procedure.caseId, status: procedure.status });
  res.json({ procedure, warnings, aiRecommendation });
});

export const updatePreOpChecklist = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  assertOtStaffAssigned(req, procedure);

  procedure.preOpChecklist = {
    ...procedure.preOpChecklist,
    ...req.body,
    completedBy: req.user.id,
    completedAt: new Date()
  };

  if (checklistComplete(procedure.preOpChecklist) && specialtyChecklistComplete(procedure.preOpChecklist, procedure.procedureType)) {
    procedure.status = "Pre-Op";
    procedure.roomStatus = "Ready";
    addStatusHistory(procedure, "Pre-Op", "Checklist completed", req.user.id);
  }

  await procedure.save();
  emitRealtime("procedure:checklist", { caseId: procedure.caseId, checklist: procedure.preOpChecklist });
  res.json(procedure.preOpChecklist);
});

export const markSurgeonReady = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");

  if (String(procedure.team.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can set ready");
  }
  ensureArrangementAcknowledged(procedure);
  const signInDone = Boolean(procedure.documentation?.nursingSummary?.whoChecklist?.signIn?.completed);
  if (!signInDone) {
    throw new ApiError(409, "Cannot mark surgeon ready before WHO Sign-In is completed");
  }
  if (!checklistComplete(procedure.preOpChecklist) || !specialtyChecklistComplete(procedure.preOpChecklist, procedure.procedureType)) {
    throw new ApiError(409, "Cannot mark ready before Pre-Op checklist is completed");
  }

  procedure.surgeonReady = true;
  await procedure.save();

  emitRealtime("procedure:surgeon-ready", { caseId: procedure.caseId });
  res.json({ surgeonReady: true });
});

export const transitionProcedure = asyncHandler(async (req, res) => {
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);

  const nextStatus = req.body.status;
  const note = req.body.note || "";
  if (["In-Progress", "Recovery", "Cleaning", "Completed", "Post-Op"].includes(nextStatus)) {
    ensureArrangementAcknowledged(procedure);
  }

  if (["In-Progress", "Recovery", "Cleaning"].includes(nextStatus)) {
    ensureRole(req, ["ot_staff", "ot_admin"]);
  } else if (["Completed", "Post-Op"].includes(nextStatus)) {
    ensureRole(req, ["surgeon", "ot_admin"]);
  } else if (["Cancelled", "Postponed", "Delayed"].includes(nextStatus)) {
    ensureRole(req, ["ot_admin"]);
  }

  if (nextStatus === "In-Progress") {
    if (!["Scheduled", "Pre-Op", "Delayed"].includes(procedure.status)) {
      throw new ApiError(409, `Cannot move to In-Progress from ${procedure.status}. Complete previous workflow step first.`);
    }
    const signInDone = Boolean(procedure.documentation?.nursingSummary?.whoChecklist?.signIn?.completed);
    if (!signInDone) {
      throw new ApiError(409, "Cannot start incision before WHO Sign-In is completed");
    }
    if (!procedure.surgeonReady || !checklistComplete(procedure.preOpChecklist) || !specialtyChecklistComplete(procedure.preOpChecklist, procedure.procedureType)) {
      throw new ApiError(409, "Pre-Op gate not complete: surgeon not ready or checklist incomplete");
    }

    const now = dayjs();
    procedure.schedule.actualTimeIn = procedure.schedule.actualTimeIn || now.subtract(5, "minute").toDate();
    procedure.schedule.actualIncisionTime = now.toDate();
    procedure.schedule.actualStartTime = now.toDate();
    if (now.isAfter(dayjs(procedure.schedule.plannedStartTime))) {
      procedure.status = "Delayed";
      addStatusHistory(procedure, "Delayed", "Start delayed - reason required", req.user.id);
      await createAlert({
        type: "delay_reason_required",
        severity: "high",
        message: `Delay reason required for ${procedure.caseId}`,
        source: "scheduler",
        metadata: { procedureId: procedure._id }
      });
    } else {
      procedure.status = "In-Progress";
    }

    procedure.roomStatus = "Live";
  } else if (nextStatus === "Recovery") {
    if (!["In-Progress", "Delayed"].includes(procedure.status)) {
      throw new ApiError(409, `Cannot move to Recovery from ${procedure.status}. Complete incision/start step first.`);
    }
    procedure.status = "Recovery";
    procedure.roomStatus = "Recovery";
    procedure.schedule.actualEndTime = new Date();
    procedure.schedule.actualDurationMinutes = dayjs(procedure.schedule.actualEndTime).diff(
      dayjs(procedure.schedule.actualStartTime || procedure.schedule.plannedStartTime),
      "minute"
    );
    await emitLateFlagIfNeeded(procedure);
  } else if (nextStatus === "Cleaning") {
    if (!["Recovery", "Completed"].includes(procedure.status)) {
      throw new ApiError(409, `Cannot move to Cleaning from ${procedure.status}. Transfer to PACU/end surgery first.`);
    }
    procedure.status = "Cleaning";
    procedure.roomStatus = "Cleaning";
    procedure.turnoverEndsAt = dayjs().add(20, "minute").toDate();
  } else if (nextStatus === "Completed") {
    throw new ApiError(409, "Case completion is only allowed via surgeon Close Case action");
  } else if (nextStatus === "Cancelled") {
    procedure.status = "Cancelled";
    procedure.roomStatus = "Idle";
    if (procedure.arrangement?.alternativesApplied?.length) {
      procedure.arrangement.reservationReleasedAt = new Date();
      await createAlert({
        type: "reservation_released",
        severity: "medium",
        message: `Reserved resources released for cancelled case ${procedure.caseId}`,
        source: "scheduler",
        metadata: { procedureId: procedure._id, caseId: procedure.caseId, releasedAt: procedure.arrangement.reservationReleasedAt }
      });
    }
  } else {
    procedure.status = nextStatus;
  }

  addStatusHistory(procedure, procedure.status, note, req.user.id);
  await procedure.save();

  emitRealtime("procedure:status", {
    procedureId: procedure._id,
    caseId: procedure.caseId,
    status: procedure.status,
    roomStatus: procedure.roomStatus,
    turnoverEndsAt: procedure.turnoverEndsAt
  });

  res.json(procedure);
});

export const logDelayReason = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);

  const { reason, note } = req.body;
  if (!reason) throw new ApiError(400, "Delay reason is required");

  procedure.delayLogs.push({ reason, note: note || "", loggedBy: req.user.id, loggedAt: new Date() });
  if (procedure.status === "Delayed") {
    addStatusHistory(procedure, "Delayed", `Reason: ${reason}`, req.user.id);
  }
  await procedure.save();

  res.status(201).json(procedure.delayLogs[procedure.delayLogs.length - 1]);
});

export const updateDocumentation = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon", "ot_staff", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");

  if (req.user.role === "surgeon" && String(procedure.team.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can edit operative report");
  }
  assertOtStaffAssigned(req, procedure);

  const payload = { ...req.body };
  const nextDoc = {
    ...procedure.documentation,
    ...payload,
    draftUpdatedAt: new Date()
  };

  if (req.user.role === "ot_staff") {
    const staffRole = await getStaffRole(req);
    if (staffRole === "Anesthesiologist") {
      if (payload.anesthesiologistOperativeReport !== undefined) {
        nextDoc.anesthesiologistOperativeReport = String(payload.anesthesiologistOperativeReport || "");
      }
      if (payload.anesthesiologistRemarks !== undefined) {
        nextDoc.anesthesiologistRemarks = String(payload.anesthesiologistRemarks || "");
      }
      if (payload.anesthesiologistOperativeReport !== undefined || payload.anesthesiologistRemarks !== undefined) {
        nextDoc.anesthesiologistReportSubmittedAt = new Date();
        nextDoc.anesthesiologistReportSubmittedBy = req.user.id;
      }
    } else if (staffRole === "Nurse") {
      if (payload.nurseOperativeReport !== undefined) {
        nextDoc.nurseOperativeReport = String(payload.nurseOperativeReport || "");
      }
      if (payload.nurseRemarks !== undefined) {
        nextDoc.nurseRemarks = String(payload.nurseRemarks || "");
      }
      if (payload.nurseOperativeReport !== undefined || payload.nurseRemarks !== undefined) {
        nextDoc.nurseReportSubmittedAt = new Date();
        nextDoc.nurseReportSubmittedBy = req.user.id;
      }
    } else {
      throw new ApiError(403, "Only nurse or anesthesiologist can submit OT staff report");
    }
  }

  procedure.documentation = nextDoc;

  if (req.body.operativeReport && req.user.role === "surgeon") {
    procedure.roomStatus = "Cleaning";
    procedure.status = procedure.status === "Completed" ? "Completed" : "Post-Op";
    procedure.turnoverEndsAt = dayjs().add(20, "minute").toDate();
    addStatusHistory(procedure, procedure.status, "Operative report submitted", req.user.id);
  }

  await procedure.save();
  emitRealtime("procedure:documentation", { caseId: procedure.caseId, draftUpdatedAt: procedure.documentation.draftUpdatedAt });

  res.json(procedure.documentation);
});

export const archiveCombinedReport = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_admin"]);
  const procedure = await Procedure.findById(req.params.id)
    .populate("patientId", "name patientCode")
    .populate("team.surgeon", "name");
  if (!procedure) throw new ApiError(404, "Procedure not found");

  const doc = procedure.documentation || {};
  const parts = [
    `Case: ${procedure.caseId}`,
    `Procedure: ${procedure.title || procedure.procedureType}`,
    `Patient: ${procedure.patientId?.name || "Unknown"}`,
    `Surgeon: ${procedure.team?.surgeon?.name || "Unknown"}`,
    "",
    "=== Surgeon Report ===",
    doc.operativeReport || "N/A",
    `Remarks: ${doc.surgeonRemarks || "N/A"}`,
    "",
    "=== Anesthesiologist Report ===",
    doc.anesthesiologistOperativeReport || "N/A",
    `Remarks: ${doc.anesthesiologistRemarks || "N/A"}`,
    "",
    "=== Nurse Report ===",
    doc.nurseOperativeReport || "N/A",
    `Remarks: ${doc.nurseRemarks || "N/A"}`
  ];

  procedure.documentation.combinedArchiveReport = parts.join("\n");
  procedure.documentation.combinedArchiveAt = new Date();
  procedure.documentation.combinedArchiveBy = req.user.id;
  procedure.documentation.draftUpdatedAt = new Date();
  await procedure.save();

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "ARCHIVE_COMBINED_REPORT",
    entityType: "Procedure",
    entityId: String(procedure._id),
    metadata: { caseId: procedure.caseId }
  });

  res.json({
    caseId: procedure.caseId,
    combinedArchiveReport: procedure.documentation.combinedArchiveReport,
    combinedArchiveAt: procedure.documentation.combinedArchiveAt
  });
});

export const requestMaterial = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  if (String(procedure.team.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can request materials");
  }

  const request = String(req.body.request || "").trim();
  if (!request) throw new ApiError(400, "request is required");
  procedure.resources.specialRequests = [...(procedure.resources.specialRequests || []), request];
  await procedure.save();

  await createAlert({
    type: "material_request",
    severity: "medium",
    message: `Material request for ${procedure.caseId}: ${request}`,
    source: "surgeon",
    metadata: { procedureId: procedure._id, request }
  });

  res.status(201).json({ request });
});

export const reassignmentOptions = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  const options = await getReassignmentOptions(procedure);
  res.json(options);
});

export const emergencyInsert = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_admin"]);
  const payload = normalizeProcedureBody({ ...req.body, priority: "Emergency" });
  const { normalized, warnings, aiRecommendation } = await validateSchedule(payload, {
    allowEmergencyPreempt: true
  });

  const procedure = await Procedure.create({
    ...normalized,
    priority: "Emergency",
    aiRecommendation,
    fatigueWarning: warnings.join(" "),
    status: "Scheduled",
    roomStatus: "Idle",
    createdBy: req.user.id,
    statusHistory: [{ status: "Scheduled", note: "Emergency inserted", changedBy: req.user.id }]
  });

  const shiftMinutes = procedure.schedule.estimatedDurationMinutes + 30;
  const shifted = await rippleShiftSchedules({
    otRoomId: procedure.otRoomId,
    fromTime: procedure.schedule.plannedStartTime,
    shiftMinutes,
    actorId: req.user.id,
    reason: "Emergency Bump",
    ignoreProcedureId: procedure._id,
    skipEmergency: true
  });

  const message = `Emergency inserted (${procedure.caseId}). Shifted ${shifted.length} surgeries by ${shiftMinutes} mins.`;
  await createAlert({
    type: "emergency_bump",
    severity: shifted.length ? "critical" : "high",
    message,
    source: "scheduler",
    metadata: { shifted, procedureId: procedure._id }
  });
  for (const item of shifted) {
    await createAlert({
      type: "surgeon_arrangement_review",
      severity: "high",
      message: item.action === "moved"
        ? `Case ${item.caseId} moved to ${item.movedToOtCode || "alternate OT"} due emergency. Surgeon acceptance required.`
        : `Case ${item.caseId} postponed by ${item.shiftMinutes} minutes due emergency. Surgeon acceptance required.`,
      source: "scheduler",
      metadata: {
        procedureId: item.id,
        caseId: item.caseId,
        surgeonId: item.surgeonId,
        action: item.action,
        previousStart: item.previousStart,
        newStart: item.newStart,
        movedToOtId: item.movedToOtId || null,
        movedToOtCode: item.movedToOtCode || null,
        notifyPersonnelIds: [item.surgeonId].filter(Boolean)
      }
    });
  }

  emitRealtime("alert:critical-path", { level: "high", message, shifted });
  emitRealtime("procedure:created", { caseId: procedure.caseId, status: procedure.status, shifted });

  res.status(201).json({ procedure, shifted, warnings });
});

export const addRemarks = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");

  if (req.user.role === "surgeon" && String(procedure.team.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can update remarks");
  }

  procedure.documentation.surgeonRemarks = req.body.remarks || "";
  procedure.documentation.draftUpdatedAt = new Date();
  await procedure.save();
  res.json({ remarks: procedure.documentation.surgeonRemarks });
});

export const logMaterialConsumption = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);

  const name = String(req.body.name || "").trim();
  const quantity = Number(req.body.quantity || 0);
  if (!name || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ApiError(400, "name and positive quantity are required");
  }

  const existing = (procedure.resources.materials || []).find((item) => item.name === name);
  if (existing) {
    existing.consumed = Number(existing.consumed || 0) + quantity;
  } else {
    procedure.resources.materials.push({ name, quantity, consumed: quantity });
  }
  addStatusHistory(procedure, procedure.status, `Material consumed: ${name} x${quantity}`, req.user.id);
  await procedure.save();
  emitRealtime("procedure:materials", { caseId: procedure.caseId, name, quantity });
  res.status(201).json({ name, quantity });
});

export const addDelayAndShift = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);

  const minutes = Number(req.body.minutes || 0);
  const reason = String(req.body.reason || "Other");
  const note = String(req.body.note || "").trim();
  if (!Number.isFinite(minutes) || minutes <= 0) throw new ApiError(400, "minutes must be a positive number");

  const validReason = ["Patient Late", "Equipment Issue", "Staff Delay", "Emergency Bump", "Other"].includes(reason)
    ? reason
    : "Other";
  procedure.delayLogs.push({ reason: validReason, note: `${reason}: +${minutes} mins ${note}`.trim(), loggedBy: req.user.id, loggedAt: new Date() });
  procedure.status = "Delayed";
  addStatusHistory(procedure, "Delayed", `Delay added: +${minutes} mins`, req.user.id);
  await procedure.save();

  const shifted = await rippleShiftSchedules({
    otRoomId: procedure.otRoomId,
    fromTime: procedure.schedule.plannedEndTime,
    shiftMinutes: minutes,
    actorId: req.user.id,
    reason
  });

  emitRealtime("procedure:updated", { caseId: procedure.caseId, status: "Delayed", shifted });
  res.json({ procedureId: procedure._id, minutes, shifted });
});

export const closeCase = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");

  if (req.user.role === "surgeon" && String(procedure.team.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can close case");
  }
  if (!["Post-Op", "Completed", "Cleaning", "Recovery"].includes(procedure.status)) {
    throw new ApiError(409, `Cannot close case while status is ${procedure.status}. Finish procedural workflow first.`);
  }

  procedure.caseLocked = true;
  procedure.caseLockedAt = new Date();
  procedure.caseLockedBy = req.user.id;
  procedure.status = "Completed";
  procedure.roomStatus = "Idle";
  addStatusHistory(procedure, "Completed", "Case closed and locked", req.user.id);
  await procedure.save();

  emitRealtime("procedure:status", { caseId: procedure.caseId, status: procedure.status, locked: true });
  res.json({ caseLocked: true, caseLockedAt: procedure.caseLockedAt });
});

export const startRoomSetup = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  if (req.user.role === "ot_staff") {
    const staffRole = await getStaffRole(req);
    if (staffRole !== "Nurse") throw new ApiError(403, "Only nurse can start setup");
  }
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);
  ensureArrangementAcknowledged(procedure);
  if (!["Scheduled", "Pre-Op"].includes(procedure.status)) {
    throw new ApiError(409, `Cannot start setup when status is ${procedure.status}`);
  }

  const nursingSummary = procedure.documentation?.nursingSummary || {};
  procedure.documentation.nursingSummary = {
    ...nursingSummary,
    roomPreparation: {
      ...(nursingSummary.roomPreparation || {}),
      setupStartedAt: new Date().toISOString()
    }
  };
  procedure.roomStatus = "Ready";
  addStatusHistory(procedure, procedure.status, "Room setup started", req.user.id);
  await procedure.save();
  emitRealtime("procedure:updated", { caseId: procedure.caseId, roomStatus: procedure.roomStatus });
  res.json({ roomPreparation: procedure.documentation.nursingSummary.roomPreparation });
});

export const completeSignIn = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  if (req.user.role === "ot_staff") {
    const staffRole = await getStaffRole(req);
    if (!["Nurse", "Anesthesiologist"].includes(staffRole)) {
      throw new ApiError(403, "Only nurse or anesthesiologist can complete Sign-In");
    }
  }
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);
  ensureArrangementAcknowledged(procedure);
  const setupStartedAt = procedure.documentation?.nursingSummary?.roomPreparation?.setupStartedAt;
  if (!setupStartedAt) {
    throw new ApiError(409, "Cannot complete Sign-In before room setup is started");
  }

  const nursingSummary = procedure.documentation?.nursingSummary || {};
  const who = nursingSummary.whoChecklist || {};
  procedure.documentation.nursingSummary = {
    ...nursingSummary,
    whoChecklist: {
      ...who,
      signIn: {
        ...(who.signIn || {}),
        completed: true,
        completedAt: new Date().toISOString()
      }
    }
  };
  procedure.roomStatus = "Patient In-Room";
  addStatusHistory(procedure, procedure.status, "WHO Sign-In completed", req.user.id);
  await procedure.save();
  emitRealtime("procedure:status", { caseId: procedure.caseId, status: procedure.status, roomStatus: procedure.roomStatus });
  res.json({ whoChecklist: procedure.documentation.nursingSummary.whoChecklist });
});

export const surgeonTimeOut = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  if (String(procedure.team.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can perform Time-Out");
  }

  const signInDone = Boolean(procedure.documentation?.nursingSummary?.whoChecklist?.signIn?.completed);
  if (!signInDone) throw new ApiError(409, "Sign-In must be completed before Time-Out");
  if (!procedure.surgeonReady) throw new ApiError(409, "Surgeon must mark ready before Time-Out");
  if (!checklistComplete(procedure.preOpChecklist) || !specialtyChecklistComplete(procedure.preOpChecklist, procedure.procedureType)) {
    throw new ApiError(409, "Pre-Op checklist must be completed before Time-Out");
  }

  const nursingSummary = procedure.documentation?.nursingSummary || {};
  const who = nursingSummary.whoChecklist || {};
  procedure.documentation.nursingSummary = {
    ...nursingSummary,
    whoChecklist: {
      ...who,
      timeOut: {
        ...(who.timeOut || {}),
        completed: true,
        completedAt: new Date().toISOString()
      }
    }
  };

  const now = dayjs();
  procedure.schedule.actualTimeIn = procedure.schedule.actualTimeIn || now.subtract(5, "minute").toDate();
  procedure.schedule.actualStartTime = procedure.schedule.actualStartTime || now.toDate();
  procedure.schedule.actualIncisionTime = now.toDate();
  procedure.status = now.isAfter(dayjs(procedure.schedule.plannedStartTime)) ? "Delayed" : "In-Progress";
  procedure.roomStatus = "Live";
  addStatusHistory(procedure, procedure.status, "Surgeon Time-Out logged (incision timestamp captured)", req.user.id);
  await procedure.save();

  emitRealtime("procedure:status", { caseId: procedure.caseId, status: procedure.status, roomStatus: procedure.roomStatus });
  res.json({ timeOutAt: procedure.schedule.actualIncisionTime, status: procedure.status });
});

export const addIntraOpMilestone = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  if (req.user.role === "ot_staff") {
    const staffRole = await getStaffRole(req);
    if (staffRole !== "Nurse") throw new ApiError(403, "Only nurse can log intra-op milestones");
  }
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);

  const label = String(req.body.label || "").trim();
  const etaMinutes = Number(req.body.etaMinutes || 0);
  if (!label) throw new ApiError(400, "Milestone label is required");

  const nursingSummary = procedure.documentation?.nursingSummary || {};
  const milestones = Array.isArray(nursingSummary.milestones) ? [...nursingSummary.milestones] : [];
  const milestone = {
    label,
    at: new Date().toISOString(),
    etaMinutes: Number.isFinite(etaMinutes) && etaMinutes > 0 ? etaMinutes : null
  };
  milestones.push(milestone);
  procedure.documentation.nursingSummary = {
    ...nursingSummary,
    milestones
  };
  addStatusHistory(procedure, procedure.status, `Milestone logged: ${label}`, req.user.id);
  await procedure.save();

  emitRealtime("procedure:updated", { caseId: procedure.caseId, milestone });
  res.status(201).json(milestone);
});

export const transferToPacu = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);
  ensureArrangementAcknowledged(procedure);
  if (!["In-Progress", "Delayed"].includes(procedure.status)) {
    throw new ApiError(409, `Cannot transfer to PACU from ${procedure.status}. Start surgery first.`);
  }

  if (req.user.role === "ot_staff" && String(procedure.team.anesthesiologist) !== String(toId(req.user.personnelProfile))) {
    throw new ApiError(403, "Only assigned anesthesiologist can transfer patient to PACU");
  }
  if (req.user.role === "ot_staff") {
    const staffRole = await getStaffRole(req);
    if (staffRole !== "Anesthesiologist") {
      throw new ApiError(403, "Only anesthesiologist can transfer patient to PACU");
    }
  }

  procedure.status = "Recovery";
  procedure.roomStatus = "Recovery";
  procedure.schedule.anesthesiaReleasedAt = new Date();
  procedure.schedule.actualEndTime = procedure.schedule.actualEndTime || new Date();
  procedure.schedule.actualDurationMinutes = dayjs(procedure.schedule.actualEndTime).diff(
    dayjs(procedure.schedule.actualStartTime || procedure.schedule.plannedStartTime),
    "minute"
  );
  await emitLateFlagIfNeeded(procedure);
  addStatusHistory(procedure, "Recovery", "Transferred to PACU (anesthesia released)", req.user.id);
  await procedure.save();

  emitRealtime("procedure:status", { caseId: procedure.caseId, status: procedure.status, roomStatus: procedure.roomStatus });
  res.json({ anesthesiaReleasedAt: procedure.schedule.anesthesiaReleasedAt });
});

export const requestTurnover = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  if (req.user.role === "ot_staff") {
    const staffRole = await getStaffRole(req);
    if (staffRole !== "Nurse") throw new ApiError(403, "Only nurse can request turnover");
  }
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);
  ensureArrangementAcknowledged(procedure);
  if (procedure.status !== "Recovery") {
    throw new ApiError(409, `Cannot request turnover while status is ${procedure.status}. Transfer to PACU first.`);
  }

  const nursingSummary = procedure.documentation?.nursingSummary || {};
  procedure.documentation.nursingSummary = {
    ...nursingSummary,
    turnover: {
      ...(nursingSummary.turnover || {}),
      requestedAt: new Date().toISOString()
    }
  };
  procedure.status = "Cleaning";
  procedure.roomStatus = "Cleaning";
  procedure.turnoverEndsAt = dayjs().add(20, "minute").toDate();
  addStatusHistory(procedure, "Cleaning", "Turnover requested", req.user.id);
  await procedure.save();

  await createAlert({
    type: "turnover_requested",
    severity: "medium",
    message: `Turnover requested for ${procedure.caseId} (${procedure.otRoomId})`,
    source: "ot_staff",
    metadata: { procedureId: procedure._id, otRoomId: procedure.otRoomId }
  });

  emitRealtime("procedure:status", { caseId: procedure.caseId, status: procedure.status, roomStatus: procedure.roomStatus, turnoverEndsAt: procedure.turnoverEndsAt });
  res.json({ turnoverEndsAt: procedure.turnoverEndsAt });
});

export const markRoomCleaned = asyncHandler(async (req, res) => {
  ensureRole(req, ["ot_staff", "ot_admin"]);
  if (req.user.role === "ot_staff") {
    const staffRole = await getStaffRole(req);
    if (staffRole !== "Nurse") throw new ApiError(403, "Only nurse can mark room cleaned");
  }
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  assertOtStaffAssigned(req, procedure);
  ensureArrangementAcknowledged(procedure);
  if (procedure.status !== "Cleaning") {
    throw new ApiError(409, `Cannot mark room cleaned while status is ${procedure.status}. Start cleaning first.`);
  }

  const nursingSummary = procedure.documentation?.nursingSummary || {};
  procedure.documentation.nursingSummary = {
    ...nursingSummary,
    turnover: {
      ...(nursingSummary.turnover || {}),
      cleanedAt: new Date().toISOString()
    }
  };
  procedure.status = "Post-Op";
  procedure.roomStatus = "Ready";
  procedure.turnoverEndsAt = new Date();
  addStatusHistory(procedure, "Post-Op", "Room cleaned and ready (awaiting surgeon close)", req.user.id);
  await procedure.save();

  const nextCase = await Procedure.findOne({
    _id: { $ne: procedure._id },
    otRoomId: procedure.otRoomId,
    status: { $in: ["Scheduled", "Pre-Op"] },
    "schedule.plannedStartTime": { $gte: new Date() }
  })
    .sort({ "schedule.plannedStartTime": 1 })
    .populate("patientId", "name");

  if (nextCase) {
    const message = `OT ${procedure.otRoomId} ready. Bring next patient ${nextCase.patientId?.name || nextCase.caseId}.`;
    await createAlert({
      type: "next_patient_ready",
      severity: "medium",
      message,
      source: "scheduler",
      metadata: { otRoomId: procedure.otRoomId, nextCaseId: nextCase.caseId, nextProcedureId: nextCase._id }
    });
    emitRealtime("alert:critical-path", { level: "medium", message });
  }

  emitRealtime("procedure:status", { caseId: procedure.caseId, status: procedure.status, roomStatus: procedure.roomStatus });
  res.json({ cleanedAt: procedure.documentation.nursingSummary.turnover.cleanedAt, nextCase: nextCase?.caseId || null });
});

export const acknowledgeArrangement = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  if (String(procedure.team?.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can acknowledge arrangement");
  }

  const arrangement = procedure.arrangement || {};
  if (!arrangement.requiresSurgeonAck) {
    procedure.arrangement = {
      ...arrangement,
      requiresSurgeonAck: false,
      surgeonAckStatus: "NotRequired"
    };
  } else {
    procedure.arrangement = {
      ...arrangement,
      surgeonAckStatus: "Acknowledged",
      surgeonAckedBy: req.user.id,
      surgeonAckedAt: new Date(),
      changeRequestReason: "",
      changeRequestedAt: null
    };
  }

  addStatusHistory(procedure, procedure.status, "Surgeon acknowledged OT arrangement", req.user.id);
  if (procedure.status === "Postponed") {
    procedure.status = "Scheduled";
    addStatusHistory(procedure, "Scheduled", "Rescheduled case accepted by surgeon", req.user.id);
  }
  if (procedure.status === "Pending") {
    const patient = await Patient.findById(procedure.patientId).select("pacStatus");
    if (patient?.pacStatus === "Cleared") {
      procedure.status = "Scheduled";
      addStatusHistory(procedure, "Scheduled", "Scheduled after surgeon arrangement acknowledgment", req.user.id);
    } else {
      addStatusHistory(procedure, "Pending", "Waiting for PAC clearance", req.user.id);
    }
  }
  await procedure.save();

  const staffTargets = [
    String(procedure.team?.anesthesiologist || ""),
    ...((procedure.team?.nurses || []).map((n) => String(n)))
  ].filter(Boolean);
  if (staffTargets.length) {
    await createAlert({
      type: "arrangement_acknowledged",
      severity: "medium",
      message: `Surgeon acknowledged arrangement for ${procedure.caseId}. Assigned OT staff may proceed.`,
      source: "surgeon",
      metadata: {
        procedureId: procedure._id,
        caseId: procedure.caseId,
        notifyPersonnelIds: staffTargets
      }
    });
  }

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "ACKNOWLEDGE_ARRANGEMENT",
    entityType: "Procedure",
    entityId: String(procedure._id),
    metadata: { caseId: procedure.caseId }
  });

  emitRealtime("procedure:updated", {
    caseId: procedure.caseId,
    arrangementStatus: procedure.arrangement?.surgeonAckStatus,
    message: `Arrangement acknowledged for ${procedure.caseId}. Assigned team can proceed.`
  });
  emitRealtime("procedure:status", {
    procedureId: procedure._id,
    caseId: procedure.caseId,
    status: procedure.status,
    roomStatus: procedure.roomStatus,
    turnoverEndsAt: procedure.turnoverEndsAt || null
  });
  res.json({ arrangement: procedure.arrangement });
});

export const requestArrangementChange = asyncHandler(async (req, res) => {
  ensureRole(req, ["surgeon"]);
  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");
  if (procedure.caseLocked) throw new ApiError(409, "Case is locked and cannot be modified");
  if (String(procedure.team?.surgeon) !== String(toId(req.user.doctorProfile) || req.user.doctorProfile)) {
    throw new ApiError(403, "Only assigned surgeon can request arrangement changes");
  }

  const reason = String(req.body.reason || "").trim();
  if (reason.length < 5) throw new ApiError(400, "reason must be at least 5 characters");

  const arrangement = procedure.arrangement || {};
  procedure.arrangement = {
    ...arrangement,
    requiresSurgeonAck: true,
    surgeonAckStatus: "ChangeRequested",
    changeRequestReason: reason,
    changeRequestedAt: new Date()
  };
  addStatusHistory(procedure, procedure.status, `Surgeon requested arrangement change: ${reason}`, req.user.id);
  await procedure.save();

  const linkedRequest = await SurgeryRequest.findOne({ scheduledProcedureId: procedure._id });
  if (linkedRequest) {
    linkedRequest.changeRequest = {
      reason,
      requestedAt: new Date(),
      requestedBy: toId(req.user.doctorProfile) || null
    };
    await linkedRequest.save();
    emitRealtime("request:processing", {
      requestId: linkedRequest._id,
      requestCode: linkedRequest.requestCode,
      status: linkedRequest.status,
      changeRequest: true
    });
  }

  await createAlert({
    type: "arrangement_change_request",
    severity: "high",
    message: `Surgeon requested arrangement change for ${procedure.caseId}`,
    source: "surgeon",
    metadata: { procedureId: procedure._id, caseId: procedure.caseId, reason }
  });

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "REQUEST_ARRANGEMENT_CHANGE",
    entityType: "Procedure",
    entityId: String(procedure._id),
    metadata: { caseId: procedure.caseId, reason }
  });

  emitRealtime("procedure:updated", { caseId: procedure.caseId, arrangementStatus: "ChangeRequested", reason });
  res.json({ arrangement: procedure.arrangement });
});
