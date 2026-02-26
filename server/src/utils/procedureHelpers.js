import dayjs from "dayjs";
import { ApiError } from "./ApiError.js";

export function toId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return null;
}

export function parseMaterials(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .filter((item) => item && (item.name || typeof item === "string"))
      .map((item) => {
        if (typeof item === "string") return { name: item.trim(), quantity: 1, consumed: 0 };
        return {
          name: String(item.name || "").trim(),
          quantity: Number(item.quantity || 1),
          consumed: Number(item.consumed || 0)
        };
      })
      .filter((item) => item.name);
  }

  return String(input)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => ({ name, quantity: 1, consumed: 0 }));
}

export function normalizeProcedureBody(body) {
  const nursesRaw = Array.isArray(body?.team?.nurses)
    ? body.team.nurses
    : Array.isArray(body.nurses)
      ? body.nurses
      : [];

  const start = body?.schedule?.plannedStartTime || body?.schedule?.startTime || body.scheduledStart;
  const estimatedDurationMinutes = Number(
    body?.schedule?.estimatedDurationMinutes || body?.estimatedDurationMinutes || 0
  );
  const fallbackEnd = start && estimatedDurationMinutes > 0
    ? dayjs(start).add(estimatedDurationMinutes, "minute").toISOString()
    : null;
  const end = body?.schedule?.plannedEndTime || body?.schedule?.endTime || body.scheduledEnd || fallbackEnd;
  const generatedCode = `SURG-${dayjs().format("YYYY")}-${Math.floor(Math.random() * 900 + 100)}`;
  const code = body.caseId || body.procedureCode || generatedCode;

  return {
    caseId: code,
    procedureCode: body.procedureCode || code,
    title: body.title,
    procedureType: body.procedureType || body.title,
    patientId: body.patientId || body.patient,
    otRoomId: body.otRoomId || body.ot,
    priority: body.priority || "Elective",
    team: {
      surgeon: toId(body?.team?.surgeon) || body.primaryDoctor,
      assistantMedic: toId(body?.team?.assistantMedic) || body.assistantSurgeon || null,
      anesthesiologist: toId(body?.team?.anesthesiologist) || body.anesthesiologistId || null,
      anesthesiaType: body?.team?.anesthesiaType || body.anesthesiaType || "General",
      nurses: nursesRaw.map((item) => toId(item)).filter(Boolean)
    },
    schedule: {
      startTime: start,
      endTime: end,
      anesthesiaPrepTimestamp: body?.schedule?.anesthesiaPrepTimestamp || body.anesthesiaPrepTimestamp || null
    },
    resources: {
      standardTray: body?.resources?.standardTray || "",
      drugs: body?.resources?.drugs || body?.requiredResources?.drugs || [],
      instruments: body?.resources?.instruments || body?.requiredResources?.instruments || [],
      materials: parseMaterials(body?.resources?.materials || body?.requiredResources?.materials),
      specialRequests: body?.resources?.specialRequests || [],
      specialRequirements: body?.resources?.specialRequirements || ""
    },
    preOpChecklist: {
      patientIdentityVerified: Boolean(body?.preOpChecklist?.patientIdentityVerified),
      consentVerified: Boolean(body?.preOpChecklist?.consentVerified),
      surgicalSiteMarked: Boolean(body?.preOpChecklist?.surgicalSiteMarked),
      anesthesiaMachineCheck: body?.preOpChecklist?.anesthesiaMachineCheck || "Pending",
      pulseOximeterFunctional: Boolean(body?.preOpChecklist?.pulseOximeterFunctional),
      allergyReviewDone: Boolean(body?.preOpChecklist?.allergyReviewDone),
      npoStatusConfirmed: Boolean(body?.preOpChecklist?.npoStatusConfirmed),
      equipmentReadinessConfirmed: Boolean(body?.preOpChecklist?.equipmentReadinessConfirmed),
      safetyTimeoutConfirmed: Boolean(body?.preOpChecklist?.safetyTimeoutConfirmed),
      prosthesisCheck: Boolean(body?.preOpChecklist?.prosthesisCheck),
      antibioticProphylaxis: Boolean(body?.preOpChecklist?.antibioticProphylaxis),
      radiologyReady: Boolean(body?.preOpChecklist?.radiologyReady),
      bloodAvailabilityConfirmed: Boolean(body?.preOpChecklist?.bloodAvailabilityConfirmed),
      anticoagulationStatusReviewed: Boolean(body?.preOpChecklist?.anticoagulationStatusReviewed),
      bowelPreparationVerified: Boolean(body?.preOpChecklist?.bowelPreparationVerified)
    },
    documentation: {
      operativeReport: body?.documentation?.operativeReport || "",
      postOpInstructions: body?.documentation?.postOpInstructions || "",
      surgeonRemarks: body?.documentation?.surgeonRemarks || "",
      liveRemarks: body?.documentation?.liveRemarks || "",
      charts: body?.documentation?.charts || [],
      draftUpdatedAt: body?.documentation?.draftUpdatedAt || null
    }
  };
}

export function addStatusHistory(doc, status, note = "", changedBy = null) {
  doc.statusHistory.push({ status, note, changedAt: new Date(), changedBy });
}

export function checklistComplete(checklist) {
  return Boolean(
    checklist?.patientIdentityVerified &&
    checklist?.consentVerified &&
    checklist?.surgicalSiteMarked &&
    checklist?.pulseOximeterFunctional &&
    checklist?.allergyReviewDone &&
    checklist?.npoStatusConfirmed &&
    checklist?.equipmentReadinessConfirmed &&
    checklist?.safetyTimeoutConfirmed &&
    checklist?.anesthesiaMachineCheck === "Pass"
  );
}

export function specialtyChecklistComplete(checklist, procedureType = "") {
  const type = String(procedureType || "").toLowerCase();
  if (type.includes("knee") || type.includes("hip") || type.includes("orthopedic")) {
    return checklist?.prosthesisCheck && checklist?.antibioticProphylaxis && checklist?.radiologyReady;
  }
  if (type.includes("cardiac") || type.includes("vascular")) {
    return checklist?.bloodAvailabilityConfirmed && checklist?.anticoagulationStatusReviewed;
  }
  if (type.includes("abdominal") || type.includes("general")) {
    return checklist?.bowelPreparationVerified;
  }
  return true;
}

export function ensureRole(req, allowed) {
  if (!allowed.includes(req.user.role)) {
    throw new ApiError(403, "Forbidden for this role");
  }
}

export function isAssignedSurgeonOrAssistant(procedure, doctorProfileId) {
  const doctorId = String(doctorProfileId || "");
  if (!doctorId) return false;
  const surgeonId = String(procedure.team?.surgeon?._id || procedure.team?.surgeon || "");
  const assistantId = String(procedure.team?.assistantMedic?._id || procedure.team?.assistantMedic || "");
  return doctorId === surgeonId || doctorId === assistantId;
}

export function isAssignedOtStaff(procedure, personnelProfileId) {
  const staffId = String(toId(personnelProfileId) || personnelProfileId || "");
  if (!staffId) return false;
  const anesthesiologistId = String(procedure.team?.anesthesiologist?._id || procedure.team?.anesthesiologist || "");
  if (anesthesiologistId === staffId) return true;
  return (procedure.team?.nurses || []).some((n) => String(n?._id || n) === staffId);
}

export function ensureArrangementAcknowledged(procedure) {
  const arrangement = procedure?.arrangement || {};
  const ackStatus = arrangement.surgeonAckStatus || "NotRequired";
  if (arrangement.requiresSurgeonAck && (ackStatus === "Pending" || ackStatus === "ChangeRequested")) {
    throw new ApiError(409, "Surgeon arrangement acknowledgement pending. Case cannot proceed yet.");
  }
}
