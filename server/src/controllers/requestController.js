import dayjs from "dayjs";
import SurgeryRequest from "../models/SurgeryRequest.js";
import Patient from "../models/Patient.js";
import Procedure from "../models/Procedure.js";
import OperationTheater from "../models/OperationTheater.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { forcePostponeConflictingProcedures, validateSchedule } from "../services/schedulerService.js";
import { logAction } from "../services/auditService.js";
import { createAlert } from "../services/alertService.js";
import { emitRealtime } from "../services/realtimeService.js";
import { buildOtSuggestions, evaluateGapForSelection } from "../services/otSuggestionService.js";

function makeCode(prefix) {
  return `${prefix}-${dayjs().format("YYYY")}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function toArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return String(raw).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
}

export const createSurgeryRequest = asyncHandler(async (req, res) => {
  if (req.user.role !== "surgeon" || !req.user.doctorProfile) {
    throw new ApiError(403, "Only surgeons can submit surgery requests");
  }

  const {
    patient,
    procedure,
    preferredStartTime,
    resources = {}
  } = req.body;

  if (!patient?.name || !patient?.mrn || !procedure?.procedureName || !preferredStartTime) {
    throw new ApiError(400, "Missing required request fields");
  }

  const requestCode = makeCode("REQ");
  const request = await SurgeryRequest.create({
    requestCode,
    requestedBy: req.user.doctorProfile,
    patient: {
      name: String(patient.name).trim(),
      age: Number(patient.age || 0),
      gender: String(patient.gender || "").trim(),
      mrn: String(patient.mrn).trim()
    },
    procedure: {
      procedureName: String(procedure.procedureName).trim(),
      side: procedure.side || "N/A",
      estimatedDurationMinutes: Number(procedure.estimatedDurationMinutes || 60),
      urgency: procedure.urgency || "Elective",
      anesthesiaPreference: String(procedure.anesthesiaPreference || "").trim(),
      requiredHvac: String(procedure.requiredHvac || "").trim()
    },
    preferredStartTime: new Date(preferredStartTime),
    resources: {
      specialEquipment: toArray(resources.specialEquipment),
      specialMaterials: toArray(resources.specialMaterials),
      specialDrugs: toArray(resources.specialDrugs)
    }
  });

  await createAlert({
    type: "request_submitted",
    severity: request.procedure.urgency === "Emergency" ? "critical" : "medium",
    message: `New surgery request ${request.requestCode} submitted`,
    source: "surgeon",
    metadata: { requestId: request._id, urgency: request.procedure.urgency }
  });

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "CREATE_SURGERY_REQUEST",
    entityType: "SurgeryRequest",
    entityId: String(request._id),
    metadata: { requestCode: request.requestCode }
  });

  emitRealtime("request:created", { requestId: request._id, requestCode: request.requestCode, urgency: request.procedure.urgency });
  res.status(201).json(request);
});

export const listSurgeryRequests = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  if (req.user.role === "surgeon") {
    if (!req.user.doctorProfile) throw new ApiError(403, "No surgeon profile attached");
    filter.requestedBy = req.user.doctorProfile;
  } else if (req.user.role !== "ot_admin") {
    throw new ApiError(403, "Forbidden");
  }

  const docs = await SurgeryRequest.find(filter)
    .populate("requestedBy", "doctorCode name specialization")
    .populate("assignment.otRoomId", "otCode")
    .populate("assignment.anesthesiologist", "staffCode name")
    .populate("assignment.nurses", "staffCode name")
    .populate("assignment.assistantMedic", "doctorCode name")
    .populate("changeRequest.requestedBy", "doctorCode name")
    .populate("scheduledProcedureId", "caseId status arrangement.requiresSurgeonAck arrangement.surgeonAckStatus arrangement.changeRequestReason arrangement.gapItems arrangement.alternativesApplied")
    .sort({ createdAt: -1 });

  if (req.user.role !== "ot_admin") {
    res.json(docs);
    return;
  }

  const items = [];
  for (const doc of docs) {
    const item = doc.toObject();
    if (["Pending", "Under-Review"].includes(item.status)) {
      const bundle = await buildOtSuggestions({ request: item });
      item.suggestion = {
        requiredItems: bundle.requiredItems,
        best: bundle.best,
        suggestions: bundle.suggestions
      };
    }
    items.push(item);
  }

  res.json(items);
});

export const getRequestSuggestions = asyncHandler(async (req, res) => {
  if (req.user.role !== "ot_admin") throw new ApiError(403, "Only admin can view room suggestions");
  const request = await SurgeryRequest.findById(req.params.id).lean();
  if (!request) throw new ApiError(404, "Surgery request not found");

  const bundle = await buildOtSuggestions({ request, overrideStartTime: req.query.startTime || request.preferredStartTime });
  res.json(bundle);
});

export const markRequestUnderReview = asyncHandler(async (req, res) => {
  if (req.user.role !== "ot_admin") throw new ApiError(403, "Only admin can process request");
  const request = await SurgeryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, "Surgery request not found");
  if (request.status === "Scheduled") throw new ApiError(409, "Scheduled request cannot be processed");
  if (request.status === "Rejected" || request.status === "Cancelled") {
    throw new ApiError(409, `Cannot process request in status ${request.status}`);
  }

  request.status = "Under-Review";
  request.reviewedBy = req.user.id;
  request.reviewedAt = new Date();
  await request.save();

  emitRealtime("request:processing", { requestId: request._id, requestCode: request.requestCode, status: request.status });
  res.json(request);
});

export const requestSurgeryChange = asyncHandler(async (req, res) => {
  if (req.user.role !== "surgeon" || !req.user.doctorProfile) {
    throw new ApiError(403, "Only surgeons can request changes");
  }

  const request = await SurgeryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, "Surgery request not found");
  if (String(request.requestedBy) !== String(req.user.doctorProfile)) {
    throw new ApiError(403, "Only request owner surgeon can submit changes");
  }
  if (["Rejected", "Cancelled"].includes(request.status)) {
    throw new ApiError(409, `Cannot request changes in status ${request.status}`);
  }

  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 5) throw new ApiError(400, "reason must be at least 5 characters");

  request.changeRequest = {
    reason,
    requestedAt: new Date(),
    requestedBy: req.user.doctorProfile
  };
  await request.save();

  await createAlert({
    type: "request_change",
    severity: "high",
    message: `Change requested for ${request.requestCode}`,
    source: "surgeon",
    metadata: { requestId: request._id, requestCode: request.requestCode, reason }
  });

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "REQUEST_SURGERY_CHANGE",
    entityType: "SurgeryRequest",
    entityId: String(request._id),
    metadata: { requestCode: request.requestCode, reason }
  });

  emitRealtime("request:processing", {
    requestId: request._id,
    requestCode: request.requestCode,
    status: request.status,
    changeRequest: true,
    reason
  });

  res.json(request);
});

export const confirmSurgeryRequest = asyncHandler(async (req, res) => {
  if (req.user.role !== "ot_admin") throw new ApiError(403, "Only admin can confirm request");

  const request = await SurgeryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, "Surgery request not found");
  if (!["Pending", "Under-Review"].includes(request.status)) {
    throw new ApiError(409, `Cannot confirm request in status ${request.status}`);
  }

  const {
    otRoomId,
    startTime,
    anesthesiologist,
    nurses = [],
    assistantMedic = null,
    anesthesiaType = "General",
    anesthesiaPrepTimestamp = null,
    adminNotes = "",
    acknowledgeGap = false,
    plannedAlternatives = [],
    forceSchedule = false,
    forceConflictOverrides = []
  } = req.body;
  const normalizedForceConflictOverrides = Array.isArray(forceConflictOverrides)
    ? forceConflictOverrides
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
    : [];
  const hasForceOverride = normalizedForceConflictOverrides.length > 0;

  if (!otRoomId || !startTime || !anesthesiologist) {
    throw new ApiError(400, "otRoomId, startTime and anesthesiologist are required");
  }

  const suggestionBundle = await buildOtSuggestions({ request, overrideStartTime: startTime });
  const gap = evaluateGapForSelection({ suggestionsBundle: suggestionBundle, selectedOtId: otRoomId });
  const normalizedPlannedAlternatives = Array.isArray(plannedAlternatives)
    ? plannedAlternatives
      .map((entry) => ({
        missing: String(entry?.missing || "").trim(),
        alternative: String(entry?.alternative || "").trim(),
        sourceType: ["mobile_pool", "other_ot_inventory", "manual"].includes(entry?.sourceType)
          ? entry.sourceType
          : "manual",
        sourceOtId: entry?.sourceOtId || null
      }))
      .filter((entry) => entry.missing && entry.alternative)
    : [];
  const plannedMissingSet = new Set(normalizedPlannedAlternatives.map((x) => x.missing.toLowerCase()));
  const unresolvedAfterPlan = (gap.selected?.unresolvable || []).filter((item) => !plannedMissingSet.has(String(item).toLowerCase()));

  if (unresolvedAfterPlan.length) {
    throw new ApiError(409, `Impossible to schedule: ${unresolvedAfterPlan.join(", ")}`);
  }
  if (gap.requiresAcknowledge && !acknowledgeGap) {
    throw new ApiError(409, "Selected room has compatibility gap. Set acknowledgeGap=true to proceed.", { gap });
  }

  const start = dayjs(startTime);
  const end = start.add(Number(request.procedure.estimatedDurationMinutes || 60), "minute");
  const computedAnesthesiaType = String(anesthesiaType || "General");
  const selectedOt = await OperationTheater.findById(otRoomId).select("hvacClass roomSize");
  if (!selectedOt) throw new ApiError(404, "OT not found");

  const payload = {
    caseId: makeCode("SURG"),
    procedureCode: makeCode("PR"),
    title: `${request.procedure.procedureName} (${request.procedure.side})`,
    procedureType: request.procedure.procedureName,
    patientId: null,
    otRoomId,
    priority: request.procedure.urgency === "Emergency" ? "Emergency" : "Elective",
    team: {
      surgeon: request.requestedBy,
      assistantMedic,
      anesthesiologist,
      anesthesiaType: computedAnesthesiaType,
      nurses
    },
    schedule: {
      startTime: start.toDate(),
      endTime: end.toDate(),
      anesthesiaPrepTimestamp: computedAnesthesiaType === "General" ? anesthesiaPrepTimestamp : null
    },
    resources: {
      standardTray: "",
      materials: toArray(request.resources?.specialMaterials).map((name) => ({ name, quantity: 1, consumed: 0 })),
      drugs: toArray(request.resources?.specialDrugs),
      instruments: toArray(request.resources?.specialEquipment),
      specialRequirements: `Urgency: ${request.procedure.urgency}. ${request.procedure.anesthesiaPreference || ""}`.trim(),
      environmentRequirements: {
        requiredHvac: request.procedure.requiredHvac || ""
      },
      specialRequests: [
        ...(gap.selected?.mobileMoves?.map((m) => `Move ${m.alternative} for ${m.missing}`) || []),
        ...normalizedPlannedAlternatives.map((m) => `Planned: ${m.alternative} for ${m.missing} (${m.sourceType})`)
      ]
    }
  };

  let patient = await Patient.findOne({ mrn: request.patient.mrn });
  if (!patient) {
    patient = await Patient.create({
      patientCode: makeCode("PAT"),
      mrn: request.patient.mrn,
      name: request.patient.name,
      age: request.patient.age,
      gender: request.patient.gender,
      bloodGroup: "",
      diagnosis: request.procedure.procedureName,
      pacStatus: "Incomplete"
    });
  } else {
    patient.name = request.patient.name;
    patient.age = request.patient.age;
    patient.gender = request.patient.gender;
    await patient.save();
  }
  payload.patientId = patient._id;

  const { normalized, warnings, aiRecommendation } = await validateSchedule(payload, {
    allowEmergencyPreempt: true,
    forceScheduleConflicts: Boolean(forceSchedule) && !hasForceOverride,
    forceConflictOverrides: normalizedForceConflictOverrides
  });

  const mergedAlternatives = [
    ...(gap.selected?.mobileMoves || []).map((m) => ({
      missing: m.missing,
      alternative: m.alternative,
      sourceType: "mobile_pool",
      sourceOtId: null
    })),
    ...normalizedPlannedAlternatives
  ];
  const requiresSurgeonAck = Boolean(mergedAlternatives.length || (gap.selected?.missingFixed || []).length);
  const pacStatus = patient.pacStatus || "Incomplete";
  const pacCleared = pacStatus === "Cleared";
  const initialProcedureStatus = pacCleared && !requiresSurgeonAck ? "Scheduled" : "Pending";
  const confirmationState = pacCleared ? "Confirmed" : "Tentative";

  const procedure = await Procedure.create({
    ...normalized,
    aiRecommendation,
    fatigueWarning: warnings.join(" "),
    status: initialProcedureStatus,
    roomStatus: "Idle",
    arrangement: {
      gapItems: gap.selected?.missingFixed || [],
      alternativesApplied: mergedAlternatives,
      requiresSurgeonAck,
      surgeonAckStatus: requiresSurgeonAck
        ? "Pending"
        : "NotRequired"
    },
    createdBy: req.user.id,
    statusHistory: [{ status: initialProcedureStatus, note: `Confirmed from request ${request.requestCode}`, changedBy: req.user.id }]
  });

  let forcePostponed = [];
  if ((Boolean(forceSchedule) || hasForceOverride) && procedure.status === "Scheduled") {
    forcePostponed = await forcePostponeConflictingProcedures({
      procedure,
      actorId: req.user.id,
      reason: "Force Schedule",
      conflictTypes: hasForceOverride
        ? normalizedForceConflictOverrides
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

  request.status = "Scheduled";
  request.adminNotes = String(adminNotes || "").trim();
  request.assignment = {
    otRoomId,
    startTime: start.toDate(),
    endTime: end.toDate(),
    anesthesiologist,
    nurses,
    assistantMedic,
    anesthesiaType: computedAnesthesiaType,
    anesthesiaPrepTimestamp: computedAnesthesiaType === "General" ? anesthesiaPrepTimestamp : null,
    compatibilityScore: gap.selected?.compatibilityScore || 0,
    gapItems: gap.selected?.missingFixed || [],
    mobileMovePlan: mergedAlternatives,
    acknowledgedGap: Boolean(acknowledgeGap),
    acknowledgedGapBy: acknowledgeGap ? req.user.id : null,
    acknowledgedGapAt: acknowledgeGap ? new Date() : null,
    pacStatus,
    confirmationState,
    finalizedAt: pacCleared ? new Date() : null
  };
  request.reviewedBy = req.user.id;
  request.reviewedAt = new Date();
  request.confirmedBy = req.user.id;
  request.confirmedAt = new Date();
  request.scheduledProcedureId = procedure._id;
  request.changeRequest = { reason: "", requestedAt: null, requestedBy: null };
  await request.save();

  await createAlert({
    type: "request_confirmed",
    severity: "medium",
    message: `Request ${request.requestCode} ${confirmationState === "Tentative" ? "saved as tentative" : "confirmed"} as ${procedure.caseId}`,
    source: "admin",
    metadata: { requestId: request._id, procedureId: procedure._id, gapItems: gap.selected?.missingFixed || [], pacStatus, confirmationState }
  });

  if ((gap.selected?.mobileMoves || []).length) {
    await createAlert({
      type: "mobile_equipment_move",
      severity: "high",
      message: `Prep list for ${procedure.caseId}: ${gap.selected.mobileMoves.map((m) => `${m.alternative} -> ${m.missing}`).join("; ")}`,
      source: "admin",
      metadata: { requestId: request._id, procedureId: procedure._id, mobileMoves: gap.selected.mobileMoves }
    });
  }

  if (normalizedPlannedAlternatives.length) {
    await createAlert({
      type: "planned_resource_reservation",
      severity: "medium",
      message: `Resource reservations planned for ${procedure.caseId}`,
      source: "admin",
      metadata: { requestId: request._id, procedureId: procedure._id, plannedAlternatives: normalizedPlannedAlternatives }
    });
  }

  if ((gap.selected?.mobileMoves || []).length || (gap.selected?.missingFixed || []).length) {
    await createAlert({
      type: "surgeon_arrangement_review",
      severity: "medium",
      message: `Arrangement update for ${procedure.caseId}: review alternatives and acknowledge or request change.`,
      source: "admin",
      metadata: {
        requestId: request._id,
        procedureId: procedure._id,
        surgeonId: String(request.requestedBy),
        gapItems: gap.selected?.missingFixed || [],
        alternativesApplied: mergedAlternatives
      }
    });
  }

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "CONFIRM_SURGERY_REQUEST",
    entityType: "SurgeryRequest",
    entityId: String(request._id),
    metadata: { requestCode: request.requestCode, procedureId: String(procedure._id), warnings, compatibilityScore: gap.selected?.compatibilityScore || 0 }
  });

  emitRealtime("request:confirmed", {
    requestId: request._id,
    requestCode: request.requestCode,
    procedureId: procedure._id,
    caseId: procedure.caseId,
    gapItems: gap.selected?.missingFixed || []
  });
  emitRealtime("procedure:created", { caseId: procedure.caseId, status: procedure.status, fromRequest: request.requestCode });

  res.json({ request, procedure, warnings, gap, forcePostponed });
});

export const finalizeRequestAfterPac = asyncHandler(async (req, res) => {
  if (req.user.role !== "ot_admin") throw new ApiError(403, "Only admin can finalize request");

  const request = await SurgeryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, "Surgery request not found");
  if (!request.scheduledProcedureId) throw new ApiError(409, "No tentative/linked procedure to finalize");

  const [procedure, patient] = await Promise.all([
    Procedure.findById(request.scheduledProcedureId),
    Patient.findOne({ mrn: request.patient.mrn })
  ]);
  if (!procedure) throw new ApiError(404, "Linked procedure not found");
  if (!patient || patient.pacStatus !== "Cleared") {
    throw new ApiError(409, "PAC is incomplete. Case remains tentative.");
  }

  request.assignment = {
    ...(request.assignment || {}),
    pacStatus: "Cleared",
    confirmationState: "Confirmed",
    finalizedAt: new Date()
  };
  request.changeRequest = { reason: "", requestedAt: null, requestedBy: null };

  const ackStatus = procedure.arrangement?.surgeonAckStatus || "NotRequired";
  const waitingForAck = procedure.arrangement?.requiresSurgeonAck && (ackStatus === "Pending" || ackStatus === "ChangeRequested");
  if (!waitingForAck && procedure.status === "Pending") {
    procedure.status = "Scheduled";
    procedure.statusHistory.push({
      status: "Scheduled",
      note: "PAC cleared and request finalized",
      changedAt: new Date(),
      changedBy: req.user.id
    });
  }

  await Promise.all([request.save(), procedure.save()]);
  emitRealtime("request:confirmed", {
    requestId: request._id,
    requestCode: request.requestCode,
    procedureId: procedure._id,
    caseId: procedure.caseId
  });
  emitRealtime("procedure:status", {
    procedureId: procedure._id,
    caseId: procedure.caseId,
    status: procedure.status,
    roomStatus: procedure.roomStatus
  });
  res.json({ request, procedure, waitingForAck });
});

export const rejectSurgeryRequest = asyncHandler(async (req, res) => {
  if (req.user.role !== "ot_admin") throw new ApiError(403, "Only admin can reject request");
  const request = await SurgeryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, "Surgery request not found");
  if (request.status === "Scheduled") throw new ApiError(409, "Scheduled request cannot be rejected");

  request.status = "Rejected";
  request.rejectionReason = String(req.body.reason || "").trim();
  request.adminNotes = String(req.body.adminNotes || "").trim();
  request.reviewedBy = req.user.id;
  request.reviewedAt = new Date();
  await request.save();

  await createAlert({
    type: "request_rejected",
    severity: "high",
    message: `Request ${request.requestCode} rejected`,
    source: "admin",
    metadata: { requestId: request._id, reason: request.rejectionReason }
  });

  emitRealtime("request:rejected", { requestId: request._id, requestCode: request.requestCode });
  res.json(request);
});
