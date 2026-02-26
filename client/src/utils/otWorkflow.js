export const ACTIVE_ROOM_STATUSES = ["Ready", "Patient In-Room", "Live", "Recovery", "Cleaning"];

const EMERGENCY_DRUGS = [
  "Propofol",
  "Fentanyl",
  "Midazolam",
  "Succinylcholine",
  "Rocuronium",
  "Atropine",
  "Epinephrine"
];

export function formatTime(dt) {
  if (!dt) return "-";
  return new Date(dt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function getOperationPendingTime(item) {
  const now = Date.now();
  const startTs = item?.schedule?.plannedStartTime ? new Date(item.schedule.plannedStartTime).getTime() : null;
  const endTs = item?.schedule?.plannedEndTime ? new Date(item.schedule.plannedEndTime).getTime() : null;
  const isLive = ACTIVE_ROOM_STATUSES.includes(item?.roomStatus) || ["In-Progress", "Delayed"].includes(item?.status);

  if (isLive && endTs) {
    const mins = Math.round((endTs - now) / 60000);
    return mins >= 0 ? `${mins} min remaining` : `${Math.abs(mins)} min overdue`;
  }
  if (startTs) {
    const mins = Math.round((startTs - now) / 60000);
    return mins >= 0 ? `starts in ${mins} min` : `started ${Math.abs(mins)} min ago`;
  }
  return "-";
}

export function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

export function isOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function staffCoversSlot(startTime, durationMinutes, shiftStart, shiftEnd) {
  if (!startTime || !durationMinutes) return true;
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return true;
  const startM = start.getHours() * 60 + start.getMinutes();
  const endM = startM + Number(durationMinutes || 0);
  return startM >= toMinutes(shiftStart) && endM <= toMinutes(shiftEnd);
}

export function toObjectMap(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return { ...value };
}

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function namesMatch(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(/\s+/).filter(Boolean));
  const tb = new Set(nb.split(/\s+/).filter(Boolean));
  const hits = Array.from(tb).filter((t) => ta.has(t)).length;
  return hits >= Math.max(1, Math.ceil(tb.size * 0.5));
}

function gateComplete(item) {
  const c = item.preOpChecklist || {};
  return (
    c.patientIdentityVerified &&
    c.consentVerified &&
    c.surgicalSiteMarked &&
    c.pulseOximeterFunctional &&
    c.allergyReviewDone &&
    c.npoStatusConfirmed &&
    c.equipmentReadinessConfirmed &&
    c.safetyTimeoutConfirmed &&
    c.anesthesiaMachineCheck === "Pass"
  );
}

export function makeVitalsRow() {
  return { time: "", bp: "", hr: "", spo2: "", etco2: "", temp: "" };
}

export function makeFluidRow() {
  return { time: "", crystalloids: "", colloids: "", bloodProducts: "", ebl: "", urineOutput: "" };
}

export function makeDrugRows(existing = []) {
  if (Array.isArray(existing) && existing.length) return existing;
  return EMERGENCY_DRUGS.map((drug) => ({ drug, checked: false, doseMg: "", time: "" }));
}

export function makeSterileCount() {
  return { initial: "", additional: "", final: "" };
}

export function makeWhoChecklist() {
  return {
    signIn: {
      completed: false,
      patientIdentityConfirmed: false,
      siteAndProcedureConfirmed: false,
      anesthesiaSafetyCheckDone: false,
      notes: ""
    },
    timeOut: {
      completed: false,
      teamPresent: false,
      patientSiteProcedureConfirmed: false,
      criticalStepsDiscussed: false,
      potentialConcernsDiscussed: false,
      notes: ""
    },
    signOut: {
      completed: false,
      procedureConfirmed: false,
      sterileCountsConfirmed: false,
      specimenLabeled: false,
      equipmentProblemsRecorded: false,
      notes: ""
    }
  };
}

export function makeNursingFocusEvents() {
  return {
    patientPositioning: "",
    skinPreparation: "",
    monitoringDevicesApplied: "",
    significantIntraOpEvents: ""
  };
}

export function isCaseAssignedToStaff(caseItem, user, isNurseStaff, isAnesthesiologistStaff) {
  if (!caseItem || !user?.personnelProfile) return false;
  const profileId = String(user.personnelProfile);
  if (isAnesthesiologistStaff) {
    return String(caseItem.team?.anesthesiologist?._id || caseItem.team?.anesthesiologist || "") === profileId;
  }
  if (isNurseStaff) {
    return (caseItem.team?.nurses || []).some((n) => String(n?._id || n) === profileId);
  }
  return false;
}

export function buildRoleActionTimeline(item) {
  return (item?.statusHistory || [])
    .map((h) => `${new Date(h.changedAt || Date.now()).toLocaleString()} | ${h.status || "-"} | ${h.note || "No note"}`)
    .join("\n");
}

export function buildAnesthesiaOperativeReportFromLog(logDraft, totals, item = null) {
  const vitals = (logDraft.vitalsGrid || [])
    .filter((row) => row.time || row.bp || row.hr || row.spo2 || row.etco2 || row.temp)
    .map((row) => `${row.time || "--"} BP:${row.bp || "-"} HR:${row.hr || "-"} SpO2:${row.spo2 || "-"} EtCO2:${row.etco2 || "-"} Temp:${row.temp || "-"}`)
    .join("\n");
  const fluids = (logDraft.fluidBalance || [])
    .filter((row) => row.time || row.crystalloids || row.colloids || row.bloodProducts || row.ebl || row.urineOutput)
    .map((row) => `${row.time || "--"} In(C:${row.crystalloids || 0},Co:${row.colloids || 0},B:${row.bloodProducts || 0}) Out(EBL:${row.ebl || 0},UO:${row.urineOutput || 0})`)
    .join("\n");
  const drugs = (logDraft.drugLog || [])
    .filter((row) => row.checked || row.doseMg || row.time)
    .map((row) => `${row.drug}: ${row.doseMg || "-"} mg at ${row.time || "--"}${row.checked ? " (given)" : ""}`)
    .join("\n");
  const timeline = buildRoleActionTimeline(item);
  return [
    "Anesthesiologist Operative Report",
    "",
    "Vitals Log:",
    vitals || "N/A",
    "",
    "Fluid Balance Log:",
    fluids || "N/A",
    "",
    `Cumulative I/O: In ${totals.totalIn} ml | Out ${totals.totalOut} ml | Balance ${totals.balance} ml`,
    "",
    "Drug Log:",
    drugs || "N/A",
    "",
    "Action Timeline (timestamped):",
    timeline || "N/A"
  ].join("\n");
}

export function buildNurseOperativeReportFromLog(logDraft, item = null) {
  const n = logDraft.nursingSummary || {};
  const who = n.whoChecklist || {};
  const milestones = (n.milestones || []).map((m) => `${m.at || "--"} ${m.label || ""}`).join("\n");
  const timeline = buildRoleActionTimeline(item);
  return [
    "Nurse Operative Report",
    "",
    "Sterile Counts:",
    `Sponge: I ${n.sponge?.initial || "-"} | A ${n.sponge?.additional || "-"} | F ${n.sponge?.final || "-"}`,
    `Needle: I ${n.needle?.initial || "-"} | A ${n.needle?.additional || "-"} | F ${n.needle?.final || "-"}`,
    `Instrument: I ${n.instrument?.initial || "-"} | A ${n.instrument?.additional || "-"} | F ${n.instrument?.final || "-"}`,
    "",
    "WHO Checklist:",
    `Sign-In: ${who.signIn?.completed ? "Completed" : "Pending"}`,
    `Time-Out: ${who.timeOut?.completed ? "Completed" : "Pending"}`,
    `Sign-Out: ${who.signOut?.completed ? "Completed" : "Pending"}`,
    "",
    "Nursing Focus Events:",
    `Positioning: ${n.focusEvents?.patientPositioning || "N/A"}`,
    `Skin Prep: ${n.focusEvents?.skinPreparation || "N/A"}`,
    `Monitoring Devices: ${n.focusEvents?.monitoringDevicesApplied || "N/A"}`,
    `Significant Events: ${n.focusEvents?.significantIntraOpEvents || "N/A"}`,
    "",
    "Milestones:",
    milestones || "N/A",
    "",
    "Action Timeline (timestamped):",
    timeline || "N/A",
    "",
    "Nursing Notes:",
    n.notes || "N/A"
  ].join("\n");
}

export function getOperationWorkflow(item) {
  const checklistDone = gateComplete(item);
  const setupStarted = Boolean(item.documentation?.nursingSummary?.roomPreparation?.setupStartedAt);
  const signInDone = Boolean(item.documentation?.nursingSummary?.whoChecklist?.signIn?.completed);
  const timeOutDone = Boolean(item.documentation?.nursingSummary?.whoChecklist?.timeOut?.completed);
  const surgeonReady = Boolean(item.surgeonReady);
  const inProgress = ["In-Progress", "Delayed", "Recovery", "Cleaning", "Completed", "Post-Op"].includes(item.status);
  const recovery = ["Recovery", "Cleaning", "Completed", "Post-Op"].includes(item.status);
  const cleaning = item.status === "Cleaning";
  const cleaned = Boolean(item.documentation?.nursingSummary?.turnover?.cleanedAt) || item.status === "Completed";
  const caseClosed = Boolean(item.caseLocked);

  return [
    { key: "setup", label: "Room setup started", done: setupStarted },
    { key: "signin", label: "WHO Sign-In completed", done: signInDone },
    { key: "checklist", label: "Pre-op checklist complete", done: checklistDone },
    { key: "ready", label: "Surgeon marked ready", done: surgeonReady },
    { key: "timeout", label: "Time-Out completed", done: timeOutDone },
    { key: "incision", label: "Incision started", done: inProgress },
    { key: "pacu", label: "Transferred to PACU / Recovery", done: recovery },
    { key: "cleaning", label: "Cleaning started", done: cleaning },
    { key: "cleaned", label: "Room cleaned", done: cleaned },
    { key: "closed", label: "Case closed/locked", done: caseClosed }
  ];
}

export function getNextRequiredStep(item) {
  const steps = getOperationWorkflow(item);
  const next = steps.find((step) => !step.done);
  return next?.key || null;
}
