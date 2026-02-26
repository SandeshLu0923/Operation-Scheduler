import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import socket from "../api/realtime.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  ACTIVE_ROOM_STATUSES,
  addMinutes,
  buildAnesthesiaOperativeReportFromLog,
  buildNurseOperativeReportFromLog,
  formatTime,
  getNextRequiredStep,
  getOperationPendingTime,
  getOperationWorkflow,
  isCaseAssignedToStaff,
  isOverlap,
  makeDrugRows,
  makeFluidRow,
  makeNursingFocusEvents,
  makeSterileCount,
  makeVitalsRow,
  makeWhoChecklist,
  namesMatch,
  normalizeText,
  staffCoversSlot,
  toObjectMap
} from "../utils/otWorkflow.js";

const checklistKeys = [
  ["patientIdentityVerified", "Patient Identity Verified"],
  ["consentVerified", "Consent Verified"],
  ["surgicalSiteMarked", "Surgical Site Marked"],
  ["pulseOximeterFunctional", "Pulse Oximeter Functional"],
  ["allergyReviewDone", "Allergy Review"],
  ["npoStatusConfirmed", "NPO Status Confirmed"],
  ["equipmentReadinessConfirmed", "Equipment Readiness"],
  ["safetyTimeoutConfirmed", "Safety Time-Out"]
];

const specialtyKeys = [
  ["prosthesisCheck", "Orthopedic: Prosthesis Check"],
  ["antibioticProphylaxis", "Orthopedic: Antibiotic Prophylaxis"],
  ["radiologyReady", "Orthopedic: Radiology Ready"],
  ["bloodAvailabilityConfirmed", "Cardiac: Blood Availability"],
  ["anticoagulationStatusReviewed", "Cardiac: Anticoagulation Reviewed"],
  ["bowelPreparationVerified", "General: Bowel Preparation"]
];

const FORCE_CONFLICT_LABELS = {
  ot: "OT",
  surgeon: "Surgeon",
  nurse: "Nurse",
  anesthesiologist: "Anesthesiologist",
  assistant: "Assistant"
};
const PROCEDURE_TEMPLATES = [
  {
    id: "thr",
    label: "Total Hip Replacement",
    procedureName: "Total Hip Arthroplasty",
    estimatedDurationMinutes: 120,
    standardTray: "C-arm",
    requiredHvac: "Laminar Flow"
  },
  {
    id: "tkr",
    label: "Total Knee Replacement",
    procedureName: "Total Knee Arthroplasty",
    estimatedDurationMinutes: 120,
    standardTray: "Knee Prosthesis Set, Implant Guide",
    requiredHvac: "Laminar Flow"
  },
  {
    id: "lap-chole",
    label: "Laparoscopic Cholecystectomy",
    procedureName: "Laparoscopic Cholecystectomy",
    estimatedDurationMinutes: 90,
    standardTray: "Laparoscopy Tower, CO2 Insufflator",
    requiredHvac: ""
  }
];

function generateOperationId() {
  return `SURG-${new Date().getFullYear()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function OperationWorkflow({ item }) {
  const [open, setOpen] = useState(false);
  const steps = getOperationWorkflow(item);
  const nextStep = getNextRequiredStep(item);
  const completed = steps.filter((step) => step.done).length;

  return (
    <div className="card workflow-card">
      <button type="button" className="workflow-toggle" onClick={() => setOpen((v) => !v)}>
        <span>{open ? "[-]" : "[+]"} Operation Workflow</span>
        <span className="muted">{completed}/{steps.length}</span>
      </button>
      {open && (
        <ul className="workflow-list">
          {steps.map((step) => {
            const state = step.done ? "done" : (step.key === nextStep ? "pending" : "blocked");
            const icon = state === "done" ? "[x]" : state === "pending" ? "[>]" : "[ ]";
            return (
              <li key={`${item._id}-${step.key}`} className={`workflow-item ${state}`}>
                <span className="workflow-icon">{icon}</span>
                <span>{step.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [ots, setOts] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  const [mobileEquipment, setMobileEquipment] = useState([]);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState("");
  const [report, setReport] = useState("");
  const [remarks, setRemarks] = useState("");
  const [materialLog, setMaterialLog] = useState({ name: "", quantity: 1 });
  const [delay, setDelay] = useState({ minutes: 15, reason: "Late Start" });
  const [prefs, setPrefs] = useState([]);
  const [prefDraft, setPrefDraft] = useState({ procedureType: "", materials: "" });
  const [requestRows, setRequestRows] = useState([]);
  const [confirmDrafts, setConfirmDrafts] = useState({});
  const [equipmentView, setEquipmentView] = useState("hidden");
  const [adminOperationSearchInput, setAdminOperationSearchInput] = useState("");
  const [adminOperationSearchQuery, setAdminOperationSearchQuery] = useState("");
  const [adminOperationSearchTriggered, setAdminOperationSearchTriggered] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState("");
  const [forceConflictOverrides, setForceConflictOverrides] = useState([]);
  const [forceConflictPrompt, setForceConflictPrompt] = useState(null);
  const [staffActiveId, setStaffActiveId] = useState("");
  const [staffRoleReport, setStaffRoleReport] = useState({ report: "", remarks: "" });
  const [staffLogDraft, setStaffLogDraft] = useState({
    vitalsGrid: [makeVitalsRow()],
    fluidBalance: [makeFluidRow()],
    drugLog: makeDrugRows(),
    nursingSummary: {
      sponge: makeSterileCount(),
      needle: makeSterileCount(),
      instrument: makeSterileCount(),
      whoChecklist: makeWhoChecklist(),
      focusEvents: makeNursingFocusEvents(),
      verification: {
        initialConfirmed: false,
        finalConfirmed: false,
        scrubNurse: "",
        circulatingNurse: "",
        verbalConfirmation: false,
        confirmationTime: ""
      },
      notes: ""
    }
  });
  const [requestForm, setRequestForm] = useState({
    templateId: "",
    selectedPatientId: "",
    patientName: "",
    patientAge: "",
    patientGender: "Male",
    patientMrn: "",
    procedureName: "",
    side: "Right",
    estimatedDurationMinutes: 90,
    urgency: "Elective",
    standardTray: "",
    specialMaterials: "",
    specialDrugs: "",
    anesthesiaPreference: "",
    preferredStartTime: "",
    requiredHvac: ""
  });
  const [booking, setBooking] = useState({
    caseId: "",
    title: "",
    procedureType: "General",
    patientId: "",
    otRoomId: "",
    surgeon: "",
    assistantMedic: "",
    anesthesiologist: "",
    nurses: [],
    anesthesiaType: "General",
    plannedStartTime: "",
    anesthesiaPrepTimestamp: "",
    estimatedDurationMinutes: 60,
    standardTray: "",
    materials: "",
    drugs: "",
    priority: "Elective"
  });
  const transcriptionPanelRef = useRef(null);
  const autoOpenedCaseRef = useRef("");

  const anesthesiologists = useMemo(() => personnel.filter((p) => p.role === "Anesthesiologist"), [personnel]);
  const nurses = useMemo(() => personnel.filter((p) => p.role === "Nurse"), [personnel]);
  const isNurseStaff = user?.role === "ot_staff" && user?.staffRole === "Nurse";
  const isAnesthesiologistStaff = user?.role === "ot_staff" && user?.staffRole === "Anesthesiologist";

  const roleAssignedCases = useMemo(
    () => rows.filter((item) => isCaseAssignedToStaff(item, user, isNurseStaff, isAnesthesiologistStaff)),
    [rows, user, isNurseStaff, isAnesthesiologistStaff]
  );
  const liveRoomCases = useMemo(
    () => roleAssignedCases.filter((item) => ACTIVE_ROOM_STATUSES.includes(item.roomStatus) && !item.caseLocked),
    [roleAssignedCases]
  );
  const nextScheduledRoleCase = useMemo(() => {
    const scheduled = roleAssignedCases
      .filter((item) => ["Scheduled", "Pre-Op"].includes(item.status) && !item.caseLocked)
      .filter((item) => item.schedule?.plannedStartTime)
      .sort((a, b) => new Date(a.schedule.plannedStartTime) - new Date(b.schedule.plannedStartTime));
    if (scheduled.length === 0) return null;
    const now = Date.now();
    return scheduled.find((item) => new Date(item.schedule.plannedStartTime).getTime() >= now) || scheduled[0];
  }, [roleAssignedCases]);
  function getLinkedProcedureForRequest(r) {
    const scheduledId = r?.scheduledProcedureId?._id || r?.scheduledProcedureId || "";
    const scheduledCaseId = r?.scheduledProcedureId?.caseId || "";
    return rows.find(
      (p) =>
        (scheduledId && String(p._id) === String(scheduledId)) ||
        (scheduledCaseId && String(p.caseId) === String(scheduledCaseId))
    ) || null;
  }
  const personalSurgicalCases = useMemo(
    () => rows.filter((r) => {
      if (r.caseLocked || ["Completed", "Cancelled"].includes(r.status)) return false;
      return true;
    }),
    [rows]
  );
  const scheduledRequestByCaseId = useMemo(() => {
    const map = new Map();
    for (const r of requestRows) {
      const caseId = r?.scheduledProcedureId?.caseId;
      if (caseId) map.set(caseId, r);
    }
    return map;
  }, [requestRows]);
  function getRequestResolutionContext(request) {
    const linkedProc = getLinkedProcedureForRequest(request);
    const scheduledProc = request?.scheduledProcedureId || {};
    const arrangement = linkedProc?.arrangement || scheduledProc?.arrangement || {};
    const gapItems = arrangement.gapItems || request?.assignment?.gapItems || [];
    const alternativesApplied = arrangement.alternativesApplied || request?.assignment?.mobileMovePlan || [];
    const hasArrangementReview = Boolean(arrangement.requiresSurgeonAck || gapItems.length || alternativesApplied.length);
    const hasRequestChange = Boolean(String(request?.changeRequest?.reason || "").trim());
    const ackStatus = hasRequestChange
      ? "ChangeRequested"
      : arrangement.surgeonAckStatus || (hasArrangementReview ? "Pending" : "NotRequired");
    const unresolvedScheduled = request?.status === "Scheduled" && (
      (linkedProc?.status === "Pending") ||
      (scheduledProc?.status === "Pending") ||
      hasRequestChange ||
      (hasArrangementReview && (ackStatus === "Pending" || ackStatus === "ChangeRequested"))
    );
    return { linkedProc, arrangement, gapItems, alternativesApplied, ackStatus, unresolvedScheduled, hasRequestChange };
  }
  const activeRequestRows = useMemo(
    () => requestRows.filter((r) => {
      if (["Pending", "Under-Review"].includes(r.status)) return true;
      return getRequestResolutionContext(r).unresolvedScheduled;
    }),
    [requestRows, rows]
  );
  const surgeonActiveRequests = useMemo(
    () => requestRows.filter((r) => {
      if (["Pending", "Under-Review"].includes(r.status)) return true;
      if (r.status !== "Scheduled") return false;
      const linkedProc = getLinkedProcedureForRequest(r);
      const arrangement = linkedProc?.arrangement || {};
      const ackStatus = arrangement.surgeonAckStatus || "NotRequired";
      return ackStatus === "Pending" || ackStatus === "ChangeRequested";
    }),
    [requestRows, rows]
  );

  const activeEquipmentCases = useMemo(
    () => rows.filter((r) => ACTIVE_ROOM_STATUSES.includes(r.roomStatus) && !r.caseLocked && !["Cancelled", "Completed"].includes(r.status)),
    [rows]
  );

  const occupancyByOt = useMemo(() => {
    const map = new Map(
      ots.map((ot) => [
        String(ot._id),
        {
          otId: String(ot._id),
          otCode: ot.otCode,
          roomName: ot.roomName || "",
          itemCounts: new Map(),
          cases: []
        }
      ])
    );

    for (const proc of activeEquipmentCases) {
      const otId = String(proc.otRoomId?._id || proc.otRoomId || "");
      if (!map.has(otId)) {
        map.set(otId, { otId, otCode: proc.otRoomId?.otCode || "OT", roomName: "", itemCounts: new Map(), cases: [] });
      }
      const row = map.get(otId);
      const materials = (proc.resources?.materials || []).filter((m) => m?.name);
      row.cases.push({
        caseId: proc.caseId,
        status: proc.status,
        materials: materials.map((m) => m.name)
      });
      for (const m of materials) {
        const qty = Number(m.quantity || 1);
        row.itemCounts.set(m.name, Number(row.itemCounts.get(m.name) || 0) + qty);
      }
    }

    return Array.from(map.values()).map((entry) => ({
      ...entry,
      items: Array.from(entry.itemCounts.entries()).map(([name, qty]) => ({ name, qty }))
    }));
  }, [ots, activeEquipmentCases]);

  const mobilePoolOccupancy = useMemo(() => {
    const used = new Map();
    for (const proc of activeEquipmentCases) {
      for (const mat of proc.resources?.materials || []) {
        const matched = mobileEquipment.find((item) => namesMatch(item.name, mat.name));
        if (!matched) continue;
        used.set(matched.name, Number(used.get(matched.name) || 0) + Number(mat.quantity || 1));
      }
    }
    return mobileEquipment.map((item) => {
      const inUse = Number(used.get(item.name) || 0);
      const total = Number(item.quantity || 0);
      return {
        name: item.name,
        total,
        inUse,
        available: Math.max(0, total - inUse)
      };
    });
  }, [mobileEquipment, activeEquipmentCases]);

  const filteredAdminOperations = useMemo(() => {
    const q = normalizeText(adminOperationSearchQuery);
    const openedCase = user?.role === "ot_admin"
      ? rows.find((item) => String(item._id) === String(activeId))
      : null;
    if (!adminOperationSearchTriggered || !q) {
      return openedCase ? [openedCase] : [];
    }

    const matches = rows
      .filter((item) => !["Cancelled", "Completed"].includes(item.status))
      .filter((item) => {
        const caseId = normalizeText(item.caseId);
        const surgeon = normalizeText(item.team?.surgeon?.name);
        const patient = normalizeText(item.patientId?.name);
        return caseId.includes(q) || surgeon.includes(q) || patient.includes(q);
      })
      .sort((a, b) => new Date(a.schedule?.plannedStartTime || 0) - new Date(b.schedule?.plannedStartTime || 0));
    if (openedCase && !matches.some((item) => String(item._id) === String(openedCase._id))) {
      return [openedCase, ...matches];
    }
    return matches;
  }, [rows, adminOperationSearchQuery, adminOperationSearchTriggered, user?.role, activeId]);

  const staffActiveCase = useMemo(
    () => roleAssignedCases.find((c) => String(c._id) === String(staffActiveId)) || null,
    [roleAssignedCases, staffActiveId]
  );
  const isAssignedAnesthesiologist = useMemo(() => {
    if (!staffActiveCase || !user?.personnelProfile) return false;
    const assigned = staffActiveCase.team?.anesthesiologist?._id || staffActiveCase.team?.anesthesiologist;
    return String(assigned || "") === String(user.personnelProfile);
  }, [staffActiveCase, user?.personnelProfile]);
  const isAssignedNurse = useMemo(() => {
    if (!staffActiveCase || !user?.personnelProfile) return false;
    return (staffActiveCase.team?.nurses || []).some(
      (n) => String(n?._id || n) === String(user.personnelProfile)
    );
  }, [staffActiveCase, user?.personnelProfile]);
async function load() {
    const tasks = [api.get("/procedures?limit=300")];
    if (user?.role === "ot_admin") {
      tasks.push(
        api.get("/admin/ots"),
        api.get("/admin/doctors"),
        api.get("/admin/patients"),
        api.get("/admin/personnel"),
        api.get("/admin/mobile-equipment")
      );
    }
    const res = await Promise.all(tasks);
    setRows(res[0].data.items || []);

    let idx = 1;
    if (user?.role === "ot_admin") {
      setOts(res[idx].data || []);
      setDoctors(res[idx + 1].data || []);
      setPatients(res[idx + 2].data || []);
      setPersonnel(res[idx + 3].data || []);
      setMobileEquipment(res[idx + 4].data || []);
      idx += 5;
      try {
        const reqRes = await api.get("/requests");
        setRequestRows(reqRes.data || []);
      } catch {
        setRequestRows([]);
      }
    }
    if (user?.role === "surgeon") {
      try {
        const [prefRes, reqRes, patientRes] = await Promise.all([
          api.get("/doctors/me/preferences"),
          api.get("/requests"),
          api.get("/patients")
        ]);
        setPrefs(prefRes.data?.templates || []);
        setRequestRows(reqRes.data || []);
        setPatients(patientRes.data || []);
      } catch {
        setPrefs([]);
        setRequestRows([]);
        setPatients([]);
      }
    }
  }

  useEffect(() => {
    let reloadTimer = null;
    let isReloading = false;
    let reloadQueued = false;

    const runLoad = async (showLoadError = false) => {
      if (isReloading) {
        reloadQueued = true;
        return;
      }

      isReloading = true;
      try {
        await load();
      } catch {
        if (showLoadError) setError("Failed to load calendar");
      } finally {
        isReloading = false;
        if (reloadQueued) {
          reloadQueued = false;
          runLoad(false);
        }
      }
    };

    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        runLoad(false);
        reloadTimer = null;
      }, 500);
    };

    runLoad(true);

    const onLive = (payload) => {
      setToast(payload?.message || `Updated ${payload?.caseId || "procedure"}`);
      scheduleReload();
      setTimeout(() => setToast(""), 2500);
    };

    socket.on("procedure:created", onLive);
    socket.on("procedure:updated", onLive);
    socket.on("procedure:status", onLive);
    socket.on("alert:critical-path", onLive);
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      socket.off("procedure:created", onLive);
      socket.off("procedure:updated", onLive);
      socket.off("procedure:status", onLive);
      socket.off("alert:critical-path", onLive);
    };
  }, [user?.role]);

  function getScheduleConflictType(err) {
    return String(err?.response?.data?.details?.conflictType || "").trim().toLowerCase();
  }

  function setSchedulingError(err, fallback) {
    const message = err?.response?.data?.message || fallback;
    const conflictType = getScheduleConflictType(err);
    if (FORCE_CONFLICT_LABELS[conflictType]) {
      setForceConflictPrompt({ conflictType, message });
      setError(message);
      return;
    }
    setForceConflictPrompt(null);
    setError(message);
  }

  async function submitAdminBooking(overrides = forceConflictOverrides) {
    const normalizedOverrides = Array.from(new Set((overrides || []).map((item) => String(item || "").toLowerCase())));
    if (processingRequestId) {
      const req = requestRows.find((r) => String(r._id) === String(processingRequestId));
      const draft = req ? getConfirmDraft(req) : null;
      if (!req) {
        setError("Selected request not found for processing");
        return;
      }
      try {
        await api.post(`/requests/${processingRequestId}/confirm`, {
          otRoomId: booking.otRoomId,
          startTime: booking.plannedStartTime,
          anesthesiologist: booking.anesthesiologist,
          nurses: booking.nurses,
          assistantMedic: booking.assistantMedic || null,
          anesthesiaType: booking.anesthesiaType,
          anesthesiaPrepTimestamp: booking.anesthesiaType === "General" ? booking.anesthesiaPrepTimestamp : null,
          adminNotes: `Processed from ${req.requestCode}`,
          acknowledgeGap: Boolean(draft?.acknowledgeGap),
          plannedAlternatives: draft?.plannedAlternatives || [],
          forceConflictOverrides: normalizedOverrides
        });
        setToast(`Request ${req.requestCode} confirmed`);
        setProcessingRequestId("");
        setForceConflictOverrides([]);
        setForceConflictPrompt(null);
        await load();
      } catch (err) {
        setSchedulingError(err, "Request confirmation failed");
      }
      return;
    }
    try {
      await api.post("/procedures", {
        caseId: booking.caseId,
        title: booking.title,
        procedureType: booking.procedureType,
        patientId: booking.patientId,
        otRoomId: booking.otRoomId,
        team: {
          surgeon: booking.surgeon,
          assistantMedic: booking.assistantMedic || null,
          anesthesiologist: booking.anesthesiologist,
          anesthesiaType: booking.anesthesiaType,
          nurses: booking.nurses
        },
        schedule: {
          startTime: booking.plannedStartTime,
          estimatedDurationMinutes: Number(booking.estimatedDurationMinutes),
          anesthesiaPrepTimestamp: booking.anesthesiaType === "General" ? booking.anesthesiaPrepTimestamp : null
        },
        resources: {
          standardTray: booking.standardTray,
          materials: booking.materials.split(/[;,]/).map((m) => ({ name: m.trim(), quantity: 1 })).filter((m) => m.name),
          drugs: booking.drugs.split(/[;,]/).map((d) => d.trim()).filter(Boolean)
        },
        priority: booking.priority,
        forceConflictOverrides: normalizedOverrides
      });
      setToast("Procedure scheduled");
      setBooking({ ...booking, caseId: "", title: "", materials: "", drugs: "" });
      setForceConflictOverrides([]);
      setForceConflictPrompt(null);
      await load();
    } catch (err) {
      setSchedulingError(err, "Create failed");
    }
  }

  async function createProcedure(e) {
    e.preventDefault();
    setError("");
    setForceConflictPrompt(null);
    await submitAdminBooking(forceConflictOverrides);
  }

  async function applyForceConflictOverride() {
    if (!forceConflictPrompt?.conflictType) return;
    const nextOverrides = Array.from(new Set([...forceConflictOverrides, forceConflictPrompt.conflictType]));
    setForceConflictOverrides(nextOverrides);
    setError("");
    setForceConflictPrompt(null);
    await submitAdminBooking(nextOverrides);
  }

  async function processRequest(request) {
    try {
      await api.patch(`/requests/${request._id}/process`);
      const bestOtId = request?.suggestion?.best?.otId || "";
      const matchedPatient = patients.find((p) => String(p.mrn || "").trim() === String(request?.patient?.mrn || "").trim());
      const surgeonId = request?.requestedBy?._id || "";
      const localStart = request?.preferredStartTime
        ? new Date(new Date(request.preferredStartTime).getTime() - new Date(request.preferredStartTime).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : "";
      setBooking((prev) => ({
        ...prev,
        caseId: prev.caseId || generateOperationId(),
        title: `${request.procedure?.procedureName || ""} (${request.procedure?.side || "N/A"})`,
        procedureType: String(request.procedure?.procedureName || "").toLowerCase().includes("hip") || String(request.procedure?.procedureName || "").toLowerCase().includes("knee")
          ? "Orthopedic"
          : String(request.procedure?.procedureName || "").toLowerCase().includes("card")
            ? "Cardiac"
            : "General",
        patientId: matchedPatient?._id || "",
        otRoomId: bestOtId,
        surgeon: surgeonId,
        plannedStartTime: localStart,
        estimatedDurationMinutes: Number(request.procedure?.estimatedDurationMinutes || 60),
        standardTray: (request.resources?.specialEquipment || []).join(", "),
        materials: (request.resources?.specialMaterials || []).join(", "),
        drugs: (request.resources?.specialDrugs || []).join(", "),
        priority: request.procedure?.urgency === "Emergency" ? "Emergency" : "Elective"
      }));
      setConfirmDraft(request._id, (draft) => ({
        ...draft,
        otRoomId: bestOtId,
        startTime: localStart,
        anesthesiaType: "General",
        anesthesiaPrepTimestamp: "",
        acknowledgeGap: false
      }));
      setProcessingRequestId(request._id);
      setForceConflictOverrides([]);
      setForceConflictPrompt(null);
      setToast(`Processing ${request.requestCode}. OT booking form auto-filled.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to process request");
    }
  }

  async function moveProcedure(item, minutes = 15, newOtId = null) {
    try {
      const start = addMinutes(item.schedule.plannedStartTime, minutes);
      const end = addMinutes(item.schedule.plannedEndTime, minutes);
      await api.put(`/procedures/${item._id}/reschedule`, {
        otRoomId: newOtId || item.otRoomId?._id,
        schedule: { startTime: start, endTime: end },
        team: {
          surgeon: item.team?.surgeon?._id,
          assistantMedic: item.team?.assistantMedic?._id,
          anesthesiologist: item.team?.anesthesiologist?._id,
          anesthesiaType: item.team?.anesthesiaType,
          nurses: (item.team?.nurses || []).map((n) => n._id)
        }
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Reschedule failed");
    }
  }

  async function setChecklist(item, key, value) {
    const current = item.preOpChecklist || {};
    try {
      await api.patch(`/procedures/${item._id}/checklist`, { ...current, [key]: value });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Checklist update failed");
    }
  }

  async function logExtraMaterial(id) {
    if (!id || !materialLog.name.trim()) return;
    try {
      await api.patch(`/procedures/${id}/material-consumption`, {
        name: materialLog.name,
        quantity: Number(materialLog.quantity)
      });
      setMaterialLog({ name: "", quantity: 1 });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Material log failed");
    }
  }

  async function addDelay(id) {
    try {
      await api.patch(`/procedures/${id}/add-delay`, delay);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Delay update failed");
    }
  }

  async function saveReport() {
    if (!activeId) {
      setError("Open a case first from Personal Surgical Calendar");
      return;
    }
    try {
      await api.patch(`/procedures/${activeId}/documentation`, {
        operativeReport: report,
        surgeonRemarks: remarks
      });
      await load();
      setToast("Report saved");
    } catch (err) {
      setError(err.response?.data?.message || "Report save failed");
    }
  }

  function getProcedureByIdLocal(id) {
    return rows.find((item) => String(item._id) === String(id)) || null;
  }

  function getStepError(item, action) {
    if (!item) return "Procedure not found";
    if (item.caseLocked) return "Case is locked";
    const signInDone = Boolean(item.documentation?.nursingSummary?.whoChecklist?.signIn?.completed);
    const setupStarted = Boolean(item.documentation?.nursingSummary?.roomPreparation?.setupStartedAt);
    const stage = String(item.status || "");
    const next = getNextRequiredStep(item);
    const actionStepMap = {
      "start-setup": "setup",
      "sign-in": "signin",
      "surgeon-ready": "ready",
      "time-out": "timeout",
      "in-progress": "incision",
      recovery: "pacu",
      cleaning: "cleaning",
      "request-turnover": "cleaning",
      "mark-cleaned": "cleaned",
      "close-case": "closed"
    };
    const targetStep = actionStepMap[action];
    if (targetStep && next && targetStep !== next) {
      const nextLabel = getOperationWorkflow(item).find((s) => s.key === next)?.label || "previous step";
      return `Complete previous step first: ${nextLabel}`;
    }

    if (action === "start-setup" && !["Scheduled", "Pre-Op"].includes(stage)) {
      return `Cannot start setup while status is ${stage}`;
    }
    if (action === "sign-in" && !setupStarted) {
      return "Start room setup before completing Sign-In";
    }
    if (action === "in-progress") {
      if (!gateComplete(item)) return "Complete pre-op checklist before starting incision";
      if (!item.surgeonReady) return "Surgeon must mark ready before starting incision";
      if (!signInDone) return "WHO Sign-In must be completed before starting incision";
    }
    if (action === "recovery" && !["In-Progress", "Delayed"].includes(stage)) {
      return "Surgery must be in progress before ending surgery";
    }
    if (action === "cleaning" && !["Recovery", "Completed"].includes(stage)) {
      return "Transfer to PACU/end surgery before starting cleaning";
    }
    if (action === "transfer-pacu" && !["In-Progress", "Delayed"].includes(stage)) {
      return "Surgery must be in progress before PACU transfer";
    }
    if (action === "request-turnover" && stage !== "Recovery") {
      return "Transfer to PACU before requesting turnover";
    }
    if (action === "mark-cleaned" && stage !== "Cleaning") {
      return "Start cleaning before marking room cleaned";
    }
    if (action === "surgeon-ready") {
      if (!signInDone) return "WHO Sign-In must be completed before surgeon ready";
      if (!gateComplete(item)) return "Pre-op checklist must be completed before surgeon ready";
    }
    if (action === "time-out") {
      if (!signInDone) return "WHO Sign-In must be completed before Time-Out";
      if (!item.surgeonReady) return "Mark surgeon ready before Time-Out";
      if (!gateComplete(item)) return "Pre-op checklist must be completed before Time-Out";
    }
    if (action === "close-case" && !["Post-Op", "Completed", "Cleaning", "Recovery"].includes(stage)) {
      return `Cannot close case while status is ${stage}`;
    }
    return "";
  }

  async function transitionStatus(id, status, fallbackMessage) {
    const item = getProcedureByIdLocal(id);
    const actionMap = {
      "In-Progress": "in-progress",
      Recovery: "recovery",
      Cleaning: "cleaning"
    };
    const stepError = getStepError(item, actionMap[status] || "");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/status`, { status });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || fallbackMessage);
    }
  }

  async function closeCase(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "close-case");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/close-case`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Close case failed");
    }
  }

  async function markReady(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "surgeon-ready");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/surgeon-ready`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Mark ready failed");
    }
  }

  async function sendSpecialRequest(id) {
    try {
      await api.patch(`/procedures/${id}/material-request`, { request: "Special Prosthetic Brand" });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Special request failed");
    }
  }

  async function startSetup(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "start-setup");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/start-setup`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Start setup failed");
    }
  }

  async function completeSignIn(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "sign-in");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/sign-in`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Sign-In update failed");
    }
  }

  async function surgeonTimeOut(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "time-out");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/time-out`);
      setToast("Time-Out logged and incision timestamp captured");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Time-Out failed");
    }
  }

  async function addMilestone(id, label, etaMinutes = 0) {
    try {
      await api.patch(`/procedures/${id}/milestone`, { label, etaMinutes });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Milestone failed");
    }
  }

  async function transferToPacu(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "transfer-pacu");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/transfer-pacu`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Transfer to PACU failed");
    }
  }

  async function requestTurnoverAction(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "request-turnover");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/request-turnover`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Turnover request failed");
    }
  }

  async function markCleaned(id) {
    const stepError = getStepError(getProcedureByIdLocal(id), "mark-cleaned");
    if (stepError) {
      setError(stepError);
      return;
    }
    try {
      await api.patch(`/procedures/${id}/mark-cleaned`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Mark cleaned failed");
    }
  }

  async function markPacFromCase(caseItem, pacStatus) {
    const patientId = caseItem?.patientId?._id || caseItem?.patientId;
    if (!patientId) {
      setError("Patient not linked on this case");
      return;
    }
    try {
      await api.patch(`/patients/${patientId}/pac`, { pacStatus });
      setToast(`PAC set to ${pacStatus} for ${caseItem.patientId?.name || "patient"}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "PAC update failed");
    }
  }

  async function acknowledgeArrangement(id) {
    try {
      await api.patch(`/procedures/${id}/acknowledge-arrangement`);
      setToast("Arrangement acknowledged");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to acknowledge arrangement");
    }
  }

  async function requestArrangementChange(id) {
    const reason = prompt("Reason for arrangement change request");
    if (!reason) return;
    try {
      await api.patch(`/procedures/${id}/request-arrangement-change`, { reason });
      setToast("Change request submitted to admin");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to request arrangement change");
    }
  }

  function openCase(item) {
    setActiveId(item._id);
    setReport(item.documentation?.operativeReport || "");
    setRemarks(item.documentation?.surgeonRemarks || "");
    if (user?.role === "ot_admin") {
      setAdminOperationSearchInput(item.caseId || "");
      setAdminOperationSearchQuery(item.caseId || "");
      setAdminOperationSearchTriggered(true);
    }
    setToast(`Opened ${item.caseId}`);
    setTimeout(() => {
      transcriptionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function openStaffCase(item) {
    const doc = item.documentation || {};
    const anesthesiaLog = doc.anesthesiaLog || {};
    const nursingSummary = doc.nursingSummary || {};
    setStaffActiveId(item._id);
    setStaffLogDraft({
      vitalsGrid: Array.isArray(anesthesiaLog.vitalsGrid) && anesthesiaLog.vitalsGrid.length
        ? anesthesiaLog.vitalsGrid
        : [makeVitalsRow()],
      fluidBalance: Array.isArray(anesthesiaLog.fluidBalance) && anesthesiaLog.fluidBalance.length
        ? anesthesiaLog.fluidBalance
        : [makeFluidRow()],
      drugLog: makeDrugRows(anesthesiaLog.drugLog),
      nursingSummary: {
        sponge: { ...makeSterileCount(), ...(nursingSummary.sponge || {}) },
        needle: { ...makeSterileCount(), ...(nursingSummary.needle || {}) },
        instrument: { ...makeSterileCount(), ...(nursingSummary.instrument || {}) },
        whoChecklist: {
          ...makeWhoChecklist(),
          ...(nursingSummary.whoChecklist || {}),
          signIn: {
            ...makeWhoChecklist().signIn,
            ...(nursingSummary.whoChecklist?.signIn || {})
          },
          timeOut: {
            ...makeWhoChecklist().timeOut,
            ...(nursingSummary.whoChecklist?.timeOut || {})
          },
          signOut: {
            ...makeWhoChecklist().signOut,
            ...(nursingSummary.whoChecklist?.signOut || {})
          }
        },
        focusEvents: {
          ...makeNursingFocusEvents(),
          ...(nursingSummary.focusEvents || {})
        },
        verification: {
          initialConfirmed: Boolean(nursingSummary.verification?.initialConfirmed),
          finalConfirmed: Boolean(nursingSummary.verification?.finalConfirmed),
          scrubNurse: nursingSummary.verification?.scrubNurse || "",
          circulatingNurse: nursingSummary.verification?.circulatingNurse || "",
          verbalConfirmation: Boolean(nursingSummary.verification?.verbalConfirmation),
          confirmationTime: nursingSummary.verification?.confirmationTime
            ? new Date(nursingSummary.verification.confirmationTime).toISOString().slice(0, 16)
            : ""
        },
        notes: nursingSummary.notes || ""
      }
    });
    if (isAnesthesiologistStaff) {
      const totals = anesthesiaLog.cumulativeIo || { totalIn: 0, totalOut: 0, balance: 0 };
      setStaffRoleReport({
        report: doc.anesthesiologistOperativeReport || buildAnesthesiaOperativeReportFromLog({
          vitalsGrid: Array.isArray(anesthesiaLog.vitalsGrid) ? anesthesiaLog.vitalsGrid : [],
          fluidBalance: Array.isArray(anesthesiaLog.fluidBalance) ? anesthesiaLog.fluidBalance : [],
          drugLog: Array.isArray(anesthesiaLog.drugLog) ? anesthesiaLog.drugLog : []
        }, totals, item),
        remarks: doc.anesthesiologistRemarks || ""
      });
    } else if (isNurseStaff) {
      setStaffRoleReport({
        report: doc.nurseOperativeReport || buildNurseOperativeReportFromLog({
          nursingSummary: {
            sponge: { ...makeSterileCount(), ...(nursingSummary.sponge || {}) },
            needle: { ...makeSterileCount(), ...(nursingSummary.needle || {}) },
            instrument: { ...makeSterileCount(), ...(nursingSummary.instrument || {}) },
            whoChecklist: {
              ...makeWhoChecklist(),
              ...(nursingSummary.whoChecklist || {})
            },
            focusEvents: {
              ...makeNursingFocusEvents(),
              ...(nursingSummary.focusEvents || {})
            },
            verification: nursingSummary.verification || {},
            milestones: Array.isArray(nursingSummary.milestones) ? nursingSummary.milestones : [],
            notes: nursingSummary.notes || ""
          }
        }, item),
        remarks: doc.nurseRemarks || ""
      });
    } else {
      setStaffRoleReport({ report: "", remarks: "" });
    }
    setToast(`Opened operation log for ${item.caseId}`);
  }

  function updateVitalsRow(index, key, value) {
    setStaffLogDraft((prev) => {
      const rows = [...prev.vitalsGrid];
      rows[index] = { ...(rows[index] || makeVitalsRow()), [key]: value };
      return { ...prev, vitalsGrid: rows };
    });
  }

  function updateFluidRow(index, key, value) {
    setStaffLogDraft((prev) => {
      const rows = [...prev.fluidBalance];
      rows[index] = { ...(rows[index] || makeFluidRow()), [key]: value };
      return { ...prev, fluidBalance: rows };
    });
  }

  function updateDrugRow(index, key, value) {
    setStaffLogDraft((prev) => {
      const rows = [...prev.drugLog];
      rows[index] = { ...(rows[index] || {}), [key]: value };
      return { ...prev, drugLog: rows };
    });
  }

  function updateCount(group, key, value) {
    setStaffLogDraft((prev) => ({
      ...prev,
      nursingSummary: {
        ...prev.nursingSummary,
        [group]: {
          ...(prev.nursingSummary?.[group] || makeSterileCount()),
          [key]: value
        }
      }
    }));
  }

  function updateVerification(key, value) {
    setStaffLogDraft((prev) => ({
      ...prev,
      nursingSummary: {
        ...prev.nursingSummary,
        verification: {
          ...(prev.nursingSummary?.verification || {}),
          [key]: value
        }
      }
    }));
  }

  function updateWhoChecklist(stage, key, value) {
    setStaffLogDraft((prev) => ({
      ...prev,
      nursingSummary: {
        ...prev.nursingSummary,
        whoChecklist: {
          ...(prev.nursingSummary?.whoChecklist || makeWhoChecklist()),
          [stage]: {
            ...((prev.nursingSummary?.whoChecklist || makeWhoChecklist())[stage] || {}),
            [key]: value
          }
        }
      }
    }));
  }

  function updateFocusEvent(key, value) {
    setStaffLogDraft((prev) => ({
      ...prev,
      nursingSummary: {
        ...prev.nursingSummary,
        focusEvents: {
          ...(prev.nursingSummary?.focusEvents || makeNursingFocusEvents()),
          [key]: value
        }
      }
    }));
  }

  const fluidTotals = useMemo(() => {
    const totalIn = (staffLogDraft.fluidBalance || []).reduce((sum, row) => (
      sum
      + Number(row.crystalloids || 0)
      + Number(row.colloids || 0)
      + Number(row.bloodProducts || 0)
    ), 0);
    const totalOut = (staffLogDraft.fluidBalance || []).reduce((sum, row) => (
      sum
      + Number(row.ebl || 0)
      + Number(row.urineOutput || 0)
    ), 0);
    return {
      totalIn,
      totalOut,
      balance: totalIn - totalOut
    };
  }, [staffLogDraft]);

  async function saveStaffOperationLog() {
    if (!staffActiveCase) {
      setError("Open a case first from Live Room Monitor or role schedule");
      return;
    }
    try {
      const payload = {};
      if (isAssignedAnesthesiologist) {
        payload.anesthesiaLog = {
          vitalsGrid: staffLogDraft.vitalsGrid,
          fluidBalance: staffLogDraft.fluidBalance,
          drugLog: staffLogDraft.drugLog,
          cumulativeIo: fluidTotals
        };
      }
      if (isAssignedNurse) {
        payload.nursingSummary = {
          ...staffLogDraft.nursingSummary,
          verification: {
            ...staffLogDraft.nursingSummary.verification,
            confirmationTime: staffLogDraft.nursingSummary.verification.confirmationTime
              ? new Date(staffLogDraft.nursingSummary.verification.confirmationTime).toISOString()
              : null
          }
        };
      }
      if (!Object.keys(payload).length) {
        setError("This case is not assigned to your OT staff profile");
        return;
      }
      await api.patch(`/procedures/${staffActiveCase._id}/documentation`, payload);
      setToast("Operation log saved");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Operation log save failed");
    }
  }

  function syncRoleReportFromLog() {
    const currentItem = staffActiveCase || null;
    if (isAssignedAnesthesiologist) {
      setStaffRoleReport((prev) => ({
        ...prev,
        report: buildAnesthesiaOperativeReportFromLog(staffLogDraft, fluidTotals, currentItem)
      }));
    } else if (isAssignedNurse) {
      setStaffRoleReport((prev) => ({
        ...prev,
        report: buildNurseOperativeReportFromLog(staffLogDraft, currentItem)
      }));
    }
  }

  async function submitStaffRoleReport() {
    if (!staffActiveCase) {
      setError("Open a case first from Live Room Monitor or role schedule");
      return;
    }
    if (!staffRoleReport.report.trim()) {
      setError("Operative report is required");
      return;
    }
    try {
      const payload = isAssignedAnesthesiologist
        ? {
          anesthesiologistOperativeReport: staffRoleReport.report,
          anesthesiologistRemarks: staffRoleReport.remarks
        }
        : isAssignedNurse
          ? {
            nurseOperativeReport: staffRoleReport.report,
            nurseRemarks: staffRoleReport.remarks
          }
          : null;

      if (!payload) {
        setError("This case is not assigned to your OT staff profile");
        return;
      }

      await api.patch(`/procedures/${staffActiveCase._id}/documentation`, payload);
      setToast("Role operative report submitted");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Role report submit failed");
    }
  }

  useEffect(() => {
    const openCaseId = searchParams.get("openCaseId");
    if (!openCaseId || !rows.length || autoOpenedCaseRef.current === openCaseId) return;
    const target = rows.find((r) => String(r._id) === String(openCaseId));
    if (!target) return;
    autoOpenedCaseRef.current = openCaseId;
    if (user?.role === "ot_staff") {
      openStaffCase(target);
    } else {
      openCase(target);
    }
  }, [rows, searchParams, user?.role]);

  useEffect(() => {
    if (!staffActiveId) return;
    if (!roleAssignedCases.some((c) => String(c._id) === String(staffActiveId))) {
      setStaffActiveId("");
    }
  }, [roleAssignedCases, staffActiveId]);

  async function savePreferenceCard() {
    try {
      const materials = prefDraft.materials
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name, quantity: 1 }));
      await api.post("/doctors/me/preferences", { procedureType: prefDraft.procedureType, materials });
      setPrefDraft({ procedureType: "", materials: "" });
      await load();
      setToast("Preference card saved");
    } catch (err) {
      setError(err.response?.data?.message || "Preference card save failed");
    }
  }

  function getConfirmDraft(request) {
    if (confirmDrafts[request._id]) return confirmDrafts[request._id];
    return {
      otRoomId: request?.suggestion?.best?.otId || "",
      startTime: request.preferredStartTime ? new Date(request.preferredStartTime).toISOString().slice(0, 16) : "",
      anesthesiologist: "",
      nurses: [],
      assistantMedic: "",
      anesthesiaType: "General",
      anesthesiaPrepTimestamp: "",
      adminNotes: "",
      acknowledgeGap: false,
      plannedAlternatives: [],
      resolvedMissingMap: {}
    };
  }

  function setConfirmDraft(id, updater) {
    setConfirmDrafts((prev) => {
      const current = prev[id] || {};
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [id]: next };
    });
  }

  function setBookingField(field, value) {
    setBooking((prev) => ({ ...prev, [field]: value }));
    if (["otRoomId", "surgeon", "assistantMedic", "anesthesiologist", "nurses", "plannedStartTime", "estimatedDurationMinutes"].includes(field)) {
      setForceConflictOverrides([]);
      setForceConflictPrompt(null);
    }
    if (!processingRequestId) return;
    const map = {
      otRoomId: "otRoomId",
      plannedStartTime: "startTime",
      anesthesiologist: "anesthesiologist",
      nurses: "nurses",
      assistantMedic: "assistantMedic",
      anesthesiaType: "anesthesiaType",
      anesthesiaPrepTimestamp: "anesthesiaPrepTimestamp"
    };
    const draftKey = map[field];
    if (!draftKey) return;
    setConfirmDraft(processingRequestId, (draft) => {
      const next = { ...draft, [draftKey]: value };
      if (field === "otRoomId") {
        next.plannedAlternatives = [];
        next.resolvedMissingMap = {};
      }
      return next;
    });
  }

  function applyProcedureTemplate(templateId) {
    const tpl = PROCEDURE_TEMPLATES.find((x) => x.id === templateId);
    setRequestForm((prev) => ({
      ...prev,
      templateId,
      procedureName: tpl?.procedureName || prev.procedureName,
      estimatedDurationMinutes: tpl?.estimatedDurationMinutes || prev.estimatedDurationMinutes,
      standardTray: tpl?.standardTray || prev.standardTray,
      requiredHvac: tpl?.requiredHvac || ""
    }));
  }

  function setRequestPatient(patientId) {
    const patient = patients.find((p) => String(p._id) === String(patientId));
    setRequestForm((prev) => ({
      ...prev,
      selectedPatientId: patientId,
      patientName: patient?.name || "",
      patientAge: patient?.age || "",
      patientGender: patient?.gender || prev.patientGender,
      patientMrn: patient?.mrn || ""
    }));
  }

  function getRequestPacStatus(request) {
    const matched = patients.find((p) => String(p.mrn || "").trim() === String(request?.patient?.mrn || "").trim());
    return matched?.pacStatus || request?.assignment?.pacStatus || "Incomplete";
  }

  async function markPacClearedForRequest(request) {
    const matched = patients.find((p) => String(p.mrn || "").trim() === String(request?.patient?.mrn || "").trim());
    if (!matched?._id) {
      setError("Patient record not found in master list for PAC update");
      return;
    }
    try {
      await api.patch(`/patients/${matched._id}/pac`, { pacStatus: "Cleared" });
      setToast(`PAC cleared for ${matched.name}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "PAC update failed");
    }
  }

  async function finalizeTentativeRequest(requestId) {
    try {
      await api.patch(`/requests/${requestId}/finalize`);
      setToast("Request finalized");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Finalize failed");
    }
  }

  async function submitSurgeryRequest(e) {
    e.preventDefault();
    try {
      await api.post("/requests", {
        patient: {
          name: requestForm.patientName,
          age: Number(requestForm.patientAge || 0),
          gender: requestForm.patientGender,
          mrn: requestForm.patientMrn
        },
        procedure: {
          procedureName: requestForm.procedureName,
          side: requestForm.side,
          estimatedDurationMinutes: Number(requestForm.estimatedDurationMinutes),
          urgency: requestForm.urgency,
          anesthesiaPreference: requestForm.anesthesiaPreference,
          requiredHvac: requestForm.requiredHvac
        },
        preferredStartTime: requestForm.preferredStartTime,
        resources: {
          specialEquipment: requestForm.standardTray,
          specialMaterials: requestForm.specialMaterials,
          specialDrugs: requestForm.specialDrugs
        }
      });
      setToast("Request submitted to Admin queue");
      setRequestForm({
        templateId: "",
        selectedPatientId: "",
        patientName: "",
        patientAge: "",
        patientGender: "Male",
        patientMrn: "",
        procedureName: "",
        side: "Right",
        estimatedDurationMinutes: 90,
        urgency: "Elective",
        standardTray: "",
        specialMaterials: "",
        specialDrugs: "",
        anesthesiaPreference: "",
        preferredStartTime: "",
        requiredHvac: ""
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Request submit failed");
    }
  }

  async function confirmRequest(request) {
    const draft = getConfirmDraft(request);
    try {
      await api.post(`/requests/${request._id}/confirm`, {
        otRoomId: draft.otRoomId,
        startTime: draft.startTime,
        anesthesiologist: draft.anesthesiologist,
        nurses: draft.nurses,
        assistantMedic: draft.assistantMedic || null,
        anesthesiaType: draft.anesthesiaType,
        anesthesiaPrepTimestamp: draft.anesthesiaType === "General" ? draft.anesthesiaPrepTimestamp : null,
        adminNotes: draft.adminNotes,
        acknowledgeGap: Boolean(draft.acknowledgeGap),
        plannedAlternatives: draft.plannedAlternatives || []
      });
      setToast(`Request ${request.requestCode} confirmed`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Request confirmation failed");
    }
  }

  async function rejectRequest(id) {
    const reason = prompt("Reject reason");
    if (!reason) return;
    try {
      await api.patch(`/requests/${id}/reject`, { reason });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Reject failed");
    }
  }

  function findMobileCandidate(itemName) {
    return mobileEquipment.find((m) => Number(m.quantity || 0) > 0 && namesMatch(m.name, itemName)) || null;
  }

  function findOtherOtInventorySources(targetOtId, itemName) {
    const rows = [];
    for (const ot of ots) {
      if (String(ot._id) === String(targetOtId)) continue;
      const inv = toObjectMap(ot.inventory);
      for (const [stockName, qtyRaw] of Object.entries(inv)) {
        const qty = Number(qtyRaw || 0);
        if (qty > 0 && namesMatch(stockName, itemName)) {
          rows.push({ otId: ot._id, otCode: ot.otCode, stockName, qty });
        }
      }
    }
    return rows.sort((a, b) => b.qty - a.qty);
  }

  function getMissingAlternatives(selectedOtId, selected, itemName) {
    const options = [];
    const mobileMove = (selected?.mobileMoves || []).find((m) => namesMatch(m.missing, itemName));
    if (mobileMove?.alternative) options.push(`Suggested mobile alternative: ${mobileMove.alternative}`);

    const mobile = findMobileCandidate(itemName);
    if (mobile) options.push(`Mobile pool available: ${mobile.name} (qty ${mobile.quantity})`);

    const other = findOtherOtInventorySources(selectedOtId, itemName)[0];
    if (other) options.push(`Other OT inventory: ${other.otCode} has ${other.stockName} (qty ${other.qty})`);

    if (!options.length) options.push("No available alternative found currently.");
    return options;
  }

  function reserveFromMobilePool(requestId, itemName) {
    const mobile = findMobileCandidate(itemName);
    if (!mobile) {
      setError(`No mobile pool availability for: ${itemName}`);
      return;
    }
    setConfirmDraft(requestId, (draft) => {
      const planned = Array.isArray(draft.plannedAlternatives) ? [...draft.plannedAlternatives] : [];
      if (!planned.some((x) => namesMatch(x.missing, itemName) && x.sourceType === "mobile_pool")) {
        planned.push({
          missing: itemName,
          alternative: mobile.name,
          sourceType: "mobile_pool"
        });
      }
      return {
        ...draft,
        plannedAlternatives: planned,
        resolvedMissingMap: { ...(draft.resolvedMissingMap || {}), [itemName]: true }
      };
    });
    setToast(`Reserved from mobile pool for this schedule: ${mobile.name}`);
  }

  function reserveFromOtherOtInventory(requestId, targetOtId, itemName) {
    const source = findOtherOtInventorySources(targetOtId, itemName)[0];
    if (!source) {
      setError(`No other OT inventory has: ${itemName}`);
      return;
    }
    setConfirmDraft(requestId, (draft) => {
      const planned = Array.isArray(draft.plannedAlternatives) ? [...draft.plannedAlternatives] : [];
      if (!planned.some((x) => namesMatch(x.missing, itemName) && x.sourceType === "other_ot_inventory")) {
        planned.push({
          missing: itemName,
          alternative: source.stockName,
          sourceType: "other_ot_inventory",
          sourceOtId: source.otId
        });
      }
      return {
        ...draft,
        plannedAlternatives: planned,
        resolvedMissingMap: { ...(draft.resolvedMissingMap || {}), [itemName]: true }
      };
    });
    setToast(`Reserved from ${source.otCode} inventory for this schedule: ${source.stockName}`);
  }

  const requestConflict = useMemo(() => {
    if (!requestForm.preferredStartTime || !Number(requestForm.estimatedDurationMinutes || 0)) return null;
    const start = new Date(requestForm.preferredStartTime);
    const end = new Date(start.getTime() + Number(requestForm.estimatedDurationMinutes) * 60000);
    const hit = rows.find((item) => isOverlap(start, end, item.schedule?.plannedStartTime, item.schedule?.plannedEndTime));
    return hit || null;
  }, [requestForm.preferredStartTime, requestForm.estimatedDurationMinutes, rows]);

  const activeCase = useMemo(() => rows.find((r) => r._id === activeId) || null, [rows, activeId]);
  const processingRequest = useMemo(
    () => requestRows.find((r) => String(r._id) === String(processingRequestId)) || null,
    [requestRows, processingRequestId]
  );
  const processingDraft = useMemo(
    () => (processingRequest ? getConfirmDraft(processingRequest) : null),
    [processingRequest, confirmDrafts]
  );
  const processingSuggestions = processingRequest?.suggestion?.suggestions || [];
  const otMatchById = useMemo(() => {
    const map = new Map();
    for (const s of processingSuggestions) {
      map.set(String(s.otId), Number(s.compatibilityScore || 0));
    }
    return map;
  }, [processingSuggestions]);
  const selectedProcessingSuggestion = useMemo(() => {
    if (!processingRequest) return null;
    const selectedOtId = booking.otRoomId || processingDraft?.otRoomId || "";
    return processingSuggestions.find((s) => String(s.otId) === String(selectedOtId)) || null;
  }, [processingRequest, processingSuggestions, booking.otRoomId, processingDraft]);
  const processingBestSuggestion = processingRequest?.suggestion?.best || null;

  return (
    <section>
      <h2>Calendar</h2>
      {toast && <div className="toast">{toast}</div>}
      {error && <p className="error">{error}</p>}

      {user?.role === "ot_admin" && (
        <>
          <div className="panel">
            <h3>OT Admin Booking</h3>
            {processingRequestId && (
              <p className="muted">
                Processing request: <strong>{processingRequest?.requestCode || processingRequestId}</strong>
              </p>
            )}
            <form className="form-grid" onSubmit={createProcedure}>
              <label>Operation ID<input value={booking.caseId} onChange={(e) => setBookingField("caseId", e.target.value)} onFocus={() => { if (!booking.caseId) setBookingField("caseId", generateOperationId()); }} onClick={() => { if (!booking.caseId) setBookingField("caseId", generateOperationId()); }} placeholder="SURG-2026-001" /></label>
              <label>Procedure<input value={booking.title} onChange={(e) => setBookingField("title", e.target.value)} required /></label>
              <label>Category<select value={booking.procedureType} onChange={(e) => setBookingField("procedureType", e.target.value)}><option>General</option><option>Orthopedic</option><option>Cardiac</option><option>Vascular</option></select></label>
              <label>Patient<select value={booking.patientId} onChange={(e) => setBookingField("patientId", e.target.value)} required={!processingRequestId} disabled={Boolean(processingRequestId)}><option value="">{processingRequestId ? "From Request" : "Select"}</option>{patients.map((p) => <option key={p._id} value={p._id}>{p.name} | {p.mrn} | {p.bloodGroup || "-"}</option>)}</select></label>
              <label>OT<select value={booking.otRoomId} onChange={(e) => setBookingField("otRoomId", e.target.value)} required><option value="">Select</option>{ots.map((o) => {
                const score = otMatchById.get(String(o._id));
                const label = score !== undefined ? `${o.otCode} (${score}% match)` : o.otCode;
                return <option key={o._id} value={o._id}>{label}</option>;
              })}</select></label>
              <label>Lead Surgeon<select value={booking.surgeon} onChange={(e) => setBookingField("surgeon", e.target.value)} required><option value="">Select</option>{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
              <label>Anesthesiologist<select value={booking.anesthesiologist} onChange={(e) => setBookingField("anesthesiologist", e.target.value)} required><option value="">Select</option>{anesthesiologists.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
              <label>Lead Nurse<select value={booking.nurses[0] || ""} onChange={(e) => setBookingField("nurses", e.target.value ? [e.target.value] : [])}><option value="">Select</option>{nurses.map((n) => <option key={n._id} value={n._id}>{n.name}</option>)}</select></label>
              <label>Anesthesia Type<select value={booking.anesthesiaType} onChange={(e) => setBookingField("anesthesiaType", e.target.value)}><option>General</option><option>Spinal</option><option>Local</option><option>MAC</option><option>Regional</option><option>Sedation</option></select></label>
              <label>Planned Start<input type="datetime-local" value={booking.plannedStartTime} onChange={(e) => setBookingField("plannedStartTime", e.target.value)} required /></label>
              {booking.anesthesiaType === "General" && (
                <label>Anesthesia Prep Time<input type="datetime-local" value={booking.anesthesiaPrepTimestamp} onChange={(e) => setBookingField("anesthesiaPrepTimestamp", e.target.value)} required /></label>
              )}
              <label>Estimated Duration (min)<input type="number" min="15" value={booking.estimatedDurationMinutes} onChange={(e) => setBookingField("estimatedDurationMinutes", e.target.value)} required /></label>
              <label>Standard Tray<input value={booking.standardTray} onChange={(e) => setBookingField("standardTray", e.target.value)} /></label>
              <label>Unique Materials<input value={booking.materials} onChange={(e) => setBookingField("materials", e.target.value)} placeholder="Titanium Mesh,Harmonic Scalpel" /></label>
              <label>Special Drugs<input value={booking.drugs} onChange={(e) => setBookingField("drugs", e.target.value)} /></label>
              <label>Priority<select value={booking.priority} onChange={(e) => setBookingField("priority", e.target.value)}><option>Elective</option><option>Emergency</option></select></label>
              <button type="submit">{processingRequestId ? "Confirm Processed Request" : "Schedule"}</button>
            </form>
            {forceConflictPrompt && (
              <div className="action-row" style={{ marginTop: 10 }}>
                <button type="button" onClick={applyForceConflictOverride}>
                  Force Schedule ({FORCE_CONFLICT_LABELS[forceConflictPrompt.conflictType] || forceConflictPrompt.conflictType} overlap)
                </button>
              </div>
            )}
            {forceConflictOverrides.length > 0 && (
              <p className="muted">Force overrides applied: {forceConflictOverrides.map((item) => FORCE_CONFLICT_LABELS[item] || item).join(", ")}</p>
            )}
            {processingRequestId && !booking.patientId && (
              <p className="muted">Patient not found in master list. It will be created from the request data on confirmation.</p>
            )}
            {processingRequestId && processingRequest && processingDraft && (() => {
              const resolvedMissingMap = processingDraft.resolvedMissingMap || {};
              const visibleMissing = (selectedProcessingSuggestion?.missingFixed || []).filter((item) => !resolvedMissingMap[item]);
              const visibleUnresolvable = (selectedProcessingSuggestion?.unresolvable || []).filter((item) => !resolvedMissingMap[item]);
              const requiresAck = selectedProcessingSuggestion
                ? visibleMissing.length > 0 ||
                  visibleUnresolvable.length > 0 ||
                  selectedProcessingSuggestion.booked ||
                  (processingBestSuggestion && String(processingBestSuggestion.otId) !== String(selectedProcessingSuggestion.otId))
                : false;
              return (
                <div className="card">
                  {processingBestSuggestion && <p className="muted">Suggested: {processingBestSuggestion.otCode} ({processingBestSuggestion.compatibilityScore}% match)</p>}
                  {selectedProcessingSuggestion && visibleMissing.length > 0 && (
                    <div className="error">
                      <p><strong>WARNING:</strong> {selectedProcessingSuggestion.otCode} is missing required fixed equipment.</p>
                      <p>Missing: {visibleMissing.join(", ")}</p>
                      {visibleMissing.map((item) => {
                        const selectedOtId = booking.otRoomId || processingDraft.otRoomId;
                        const alts = getMissingAlternatives(selectedOtId, selectedProcessingSuggestion, item);
                        const hasMobile = Boolean(findMobileCandidate(item));
                        const hasOtherOt = findOtherOtInventorySources(selectedOtId, item).length > 0;
                        return (
                          <div key={`miss-booking-${processingRequest._id}-${item}`} className="monitor-card">
                            <p><strong>Missing Item:</strong> {item}</p>
                            <p><strong>Alternatives:</strong> {alts.join(" | ")}</p>
                            <div className="action-row">
                              <button
                                type="button"
                                disabled={!(booking.otRoomId || processingDraft.otRoomId) || !hasMobile}
                                onClick={() => reserveFromMobilePool(processingRequest._id, item)}
                              >
                                Add from Mobile Pool
                              </button>
                              {hasOtherOt && (
                                <button
                                  type="button"
                                  disabled={!(booking.otRoomId || processingDraft.otRoomId)}
                                  onClick={() => reserveFromOtherOtInventory(processingRequest._id, booking.otRoomId || processingDraft.otRoomId, item)}
                                >
                                  Add from Other OT Inventory
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {selectedProcessingSuggestion && visibleUnresolvable.length > 0 && (
                    <div className="error">
                      <p><strong>Impossible to Schedule:</strong> {visibleUnresolvable.join(", ")} unavailable in fixed + mobile pool + other OT inventory.</p>
                    </div>
                  )}
                  {requiresAck && (
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(processingDraft.acknowledgeGap)}
                        onChange={(e) => setConfirmDraft(processingRequest._id, { ...processingDraft, acknowledgeGap: e.target.checked })}
                      />{" "}
                      Acknowledge Gap
                    </label>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="panel">
            <h3>Pending Requests Queue</h3>
            {activeRequestRows.length === 0 && <p className="muted">No pending requests.</p>}
            {activeRequestRows.map((request) => {
              const best = request?.suggestion?.best || null;
              const pacStatus = getRequestPacStatus(request);
              const confirmationState = request?.assignment?.confirmationState || (pacStatus === "Cleared" ? "Confirmed" : "Tentative");
              const resolution = getRequestResolutionContext(request);
              const requestedChangeReason = String(request?.changeRequest?.reason || resolution.arrangement?.changeRequestReason || "").trim();
              const isChangeRequested = Boolean(requestedChangeReason) || resolution.ackStatus === "ChangeRequested";
              const queueStatusLabel = isChangeRequested
                ? "Change Requested"
                : request.status === "Under-Review"
                  ? "Processed"
                  : request.status === "Scheduled"
                    ? "Completed"
                    : request.status;
              return (
                <div key={request._id} className="monitor-card">
                  <p><strong>{request.requestCode}</strong> | {request.procedure?.procedureName} ({request.procedure?.side}) | {request.procedure?.urgency}</p>
                  <p>Status: <strong>{queueStatusLabel}</strong></p>
                  {best && <p className="muted">Suggested: {best.otCode} ({best.compatibilityScore}% match)</p>}
                  <p>Patient: {request.patient?.name} | MRN: {request.patient?.mrn} | Preferred: {formatTime(request.preferredStartTime)}</p>
                  <p>PAC: <strong>{pacStatus}</strong> | Booking State: <strong>{confirmationState}</strong></p>
                  <p>Requested Change: <strong>{requestedChangeReason || "-"}</strong></p>
                  {request.status === "Scheduled" && (
                    <p>Arrangement Review: <strong>{resolution.ackStatus}</strong></p>
                  )}
                  {resolution.gapItems.length > 0 && (
                    <p className="muted">Gap Items: {resolution.gapItems.join(", ")}</p>
                  )}
                  {resolution.alternativesApplied.length > 0 && (
                    <p className="muted">Applied Alternatives: {resolution.alternativesApplied.map((m) => `${m.alternative} for ${m.missing}`).join("; ")}</p>
                  )}
                  {isChangeRequested && requestedChangeReason && (
                    <p className="error">Requested Change: {requestedChangeReason}</p>
                  )}
                  <div className="action-row">
                    {["Pending", "Under-Review"].includes(request.status) && (
                      <button onClick={() => processRequest(request)}>{request.status === "Under-Review" ? "Continue Processing" : "Process"}</button>
                    )}
                    {request.status === "Scheduled" && resolution.linkedProc && (
                      <button onClick={() => openCase(resolution.linkedProc)}>Open Case</button>
                    )}
                    {pacStatus !== "Cleared" && <button onClick={() => markPacClearedForRequest(request)}>Mark PAC Cleared</button>}
                    {request.scheduledProcedureId && <button onClick={() => finalizeTentativeRequest(request._id)}>Finalize</button>}
                    <button onClick={() => rejectRequest(request._id)}>Reject</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <h3>Operations</h3>
            <div className="action-row">
              <input
                value={adminOperationSearchInput}
                onChange={(e) => setAdminOperationSearchInput(e.target.value)}
                placeholder="Search by Operation ID, Surgeon name, or Patient name"
              />
              <button
                type="button"
                onClick={() => {
                  setAdminOperationSearchTriggered(true);
                  setAdminOperationSearchQuery(adminOperationSearchInput);
                }}
              >
                Search
              </button>
            </div>
            {!adminOperationSearchTriggered && <p className="muted">Search using Operation ID, Surgeon name, or Patient name.</p>}
            {adminOperationSearchTriggered && !normalizeText(adminOperationSearchQuery) && <p className="muted">Enter a search value and click Search.</p>}
            {adminOperationSearchTriggered && normalizeText(adminOperationSearchQuery) && filteredAdminOperations.length === 0 && (
              <p className="muted">No matching operations found.</p>
            )}
            {filteredAdminOperations.map((item) => {
              const isLive = ACTIVE_ROOM_STATUSES.includes(item.roomStatus) || ["In-Progress", "Delayed"].includes(item.status);
              const pendingTime = getOperationPendingTime(item);
              return (
              <div key={item._id} className="monitor-card">
                <p><strong>{item.caseId}</strong> {item.procedureType} | {item.otRoomId?.otCode} | {formatTime(item.schedule?.plannedStartTime)} - {formatTime(item.schedule?.plannedEndTime)}</p>
                <p>Status: <strong>{isLive ? "Live" : item.status}</strong> | Pending: <strong>{pendingTime}</strong></p>
                <p>Surgeon: {item.team?.surgeon?.name || "-"} | Patient: {item.patientId?.name || "-"}</p>
                {isLive ? (
                  <OperationWorkflow item={item} />
                ) : (
                  <p className="muted">Scheduled operation. Countdown shown until planned start.</p>
                )}
              </div>
            );
            })}
          </div>

          <div className="panel">
            <h3>Equipment Occupancy</h3>
            <label className="field" style={{ maxWidth: 260 }}>
              <span>View</span>
              <select value={equipmentView} onChange={(e) => setEquipmentView(e.target.value)}>
                <option value="hidden">Hide Details</option>
                <option value="expanded">Show Details</option>
              </select>
            </label>
            {equipmentView === "expanded" && (
              <>
                <p className="muted">Occupied means room is currently active: Ready, Patient In-Room, Live, Recovery, Cleaning.</p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>OT</th>
                        <th>Active Cases</th>
                        <th>Occupied Items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {occupancyByOt.map((ot) => (
                        <tr key={ot.otId}>
                          <td>{ot.otCode}{ot.roomName ? ` (${ot.roomName})` : ""}</td>
                          <td>
                            {ot.cases.length === 0
                              ? "None"
                              : ot.cases.map((c) => `${c.caseId} [${c.status}]`).join(", ")}
                          </td>
                          <td>
                            {ot.items.length === 0
                              ? "None"
                              : ot.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h4>Mobile Pool Availability</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Total</th>
                        <th>In Use</th>
                        <th>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mobilePoolOccupancy.map((m) => (
                        <tr key={m.name}>
                          <td>{m.name}</td>
                          <td>{m.total}</td>
                          <td>{m.inUse}</td>
                          <td>{m.available}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {user?.role === "ot_staff" && (
        <div className="panel-grid">
          <div className="panel">
            <h3>Live Room Monitor + Status</h3>
            {liveRoomCases.length === 0 && <p className="muted">No live room operations assigned to your role right now.</p>}
            {liveRoomCases.map((item) => {
              const signInDone = Boolean(item.documentation?.nursingSummary?.whoChecklist?.signIn?.completed);
              const setupStarted = Boolean(item.documentation?.nursingSummary?.roomPreparation?.setupStartedAt);
              const nextStep = getNextRequiredStep(item);
              const canStart = nextStep === "incision" && gateComplete(item) && signInDone && item.surgeonReady && !item.caseLocked;
              const canStartSetup = nextStep === "setup" && ["Scheduled", "Pre-Op"].includes(item.status) && !item.caseLocked;
              const canCompleteSignIn = nextStep === "signin" && setupStarted && !item.caseLocked;
              const canEndSurgery = nextStep === "pacu" && ["In-Progress", "Delayed"].includes(item.status) && !item.caseLocked;
              const canStartCleaning = nextStep === "cleaning" && ["Recovery", "Completed"].includes(item.status) && !item.caseLocked;
              const canTransferPacu = nextStep === "pacu" && ["In-Progress", "Delayed"].includes(item.status) && !item.caseLocked;
              const canRequestTurnover = nextStep === "cleaning" && item.status === "Recovery" && !item.caseLocked;
              const canMarkCleaned = nextStep === "cleaned" && item.status === "Cleaning" && !item.caseLocked;
              return (
                <article key={item._id} className="monitor-card">
                  <p><strong>{item.caseId}</strong> | {item.otRoomId?.otCode}</p>
                  <p>Room Status: {item.roomStatus}</p>
                  <div className="action-row">
                    {isNurseStaff && <button disabled={!canStartSetup} onClick={() => startSetup(item._id)}>Start Setup</button>}
                    {(isNurseStaff || isAnesthesiologistStaff) && <button disabled={!canCompleteSignIn} onClick={() => completeSignIn(item._id)}>Complete Sign-In</button>}
                    {isNurseStaff && <button disabled={!canStart} onClick={() => transitionStatus(item._id, "In-Progress", "Failed to start incision")}>[START INCISION]</button>}
                    {isNurseStaff && <button disabled={!canEndSurgery} onClick={() => transitionStatus(item._id, "Recovery", "Failed to end surgery")}>[END SURGERY]</button>}
                    {isNurseStaff && <button disabled={!canStartCleaning} onClick={() => transitionStatus(item._id, "Cleaning", "Failed to start cleaning")}>[START CLEANING]</button>}
                    {isAnesthesiologistStaff && <button disabled={!canTransferPacu} onClick={() => transferToPacu(item._id)}>Transfer to PACU</button>}
                    {isNurseStaff && <button onClick={() => addMilestone(item._id, "Closure Started", 15)}>Closure Started (+15m)</button>}
                    {isNurseStaff && <button disabled={!canRequestTurnover} onClick={() => requestTurnoverAction(item._id)}>Request Turnover</button>}
                    {isNurseStaff && <button disabled={!canMarkCleaned} onClick={() => markCleaned(item._id)}>Cleaned</button>}
                  <button onClick={() => openStaffCase(item)}>Open Case</button>
                </div>
                <OperationWorkflow item={item} />
                {isNurseStaff && (
                    <>
                      <div className="action-row">
                        <input type="number" min="5" value={delay.minutes} onChange={(e) => setDelay({ ...delay, minutes: Number(e.target.value) })} style={{ maxWidth: 90 }} />
                        <input value={delay.reason} onChange={(e) => setDelay({ ...delay, reason: e.target.value })} placeholder="Delay reason" />
                        <button onClick={() => addDelay(item._id)}>Add Delay</button>
                      </div>
                      <div className="action-row">
                        <input value={materialLog.name} onChange={(e) => setMaterialLog({ ...materialLog, name: e.target.value })} placeholder="Extra material" />
                        <input type="number" min="1" value={materialLog.quantity} onChange={(e) => setMaterialLog({ ...materialLog, quantity: Number(e.target.value) })} style={{ maxWidth: 80 }} />
                        <button onClick={() => logExtraMaterial(item._id)}>Log Material</button>
                      </div>
                    </>
                  )}
                  {isAnesthesiologistStaff && (
                    <div className="action-row">
                      <button onClick={() => markPacFromCase(item, "Cleared")}>PAC Cleared</button>
                      <button onClick={() => markPacFromCase(item, "Incomplete")}>PAC Incomplete</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {isNurseStaff ? (
            <div className="panel">
              <h3>{staffActiveCase ? `${staffActiveCase.procedureType || "Procedure"} Checklist` : "Procedure Checklist"}</h3>
              {!staffActiveCase && <p className="muted">Open a case to edit checklist for that specific operation.</p>}
              {staffActiveCase && (
                <div className="card">
                  {(() => {
                    const item = staffActiveCase;
                    return (
                      <>
                        <p><strong>{item.caseId}</strong> ({item.procedureType})</p>
                        {checklistKeys.map(([key, label]) => (
                          <label key={key}><input type="checkbox" checked={Boolean(item.preOpChecklist?.[key])} onChange={(e) => setChecklist(item, key, e.target.checked)} /> {label}</label>
                        ))}
                        <label className="field"><span>Anesthesia Machine Check</span>
                          <select value={item.preOpChecklist?.anesthesiaMachineCheck || "Pending"} onChange={(e) => setChecklist(item, "anesthesiaMachineCheck", e.target.value)}>
                            <option>Pending</option><option>Pass</option><option>Fail</option>
                          </select>
                        </label>
                        {specialtyKeys.map(([key, label]) => (
                          <label key={key}><input type="checkbox" checked={Boolean(item.preOpChecklist?.[key])} onChange={(e) => setChecklist(item, key, e.target.checked)} /> {label}</label>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ) : (
            <div className="panel">
              <h3>Next Scheduled Case</h3>
              {!nextScheduledRoleCase && <p className="muted">No upcoming scheduled operations assigned to your role.</p>}
              {nextScheduledRoleCase && (
                <article className="monitor-card">
                  <p><strong>{nextScheduledRoleCase.caseId}</strong> | {nextScheduledRoleCase.otRoomId?.otCode}</p>
                  <p>{new Date(nextScheduledRoleCase.schedule?.plannedStartTime).toLocaleString()} | {nextScheduledRoleCase.status}</p>
                  <p>Pending: <strong>{getOperationPendingTime(nextScheduledRoleCase)}</strong></p>
                  <div className="action-row">
                    <button type="button" onClick={() => openStaffCase(nextScheduledRoleCase)}>Open Case</button>
                  </div>
                  <OperationWorkflow item={nextScheduledRoleCase} />
                </article>
              )}
            </div>
          )}

          <div className="panel transcription-panel operation-log-panel">
            <h3>Operation Log (Role-Based)</h3>
            {!staffActiveCase && <p className="muted">Open a case from Live Room Monitor or role schedule to start log entry.</p>}
            {staffActiveCase && (
              <>
                <p className="muted">
                  Logging: <strong>{staffActiveCase.caseId}</strong> | {staffActiveCase.otRoomId?.otCode} | {staffActiveCase.status}
                </p>
                {!isAssignedAnesthesiologist && !isAssignedNurse && (
                  <p className="error">You are not assigned as anesthesiologist or nurse for this case.</p>
                )}

                {isAssignedAnesthesiologist && (
                  <>
                    <h4>Anesthesiologist Log</h4>
                    <p className="muted">Landscape log with Vitals Grid, cumulative fluid I/O, and check-time drug chart every 15-30 minutes.</p>
                <div className="table-wrap op-log-landscape">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>BP</th>
                        <th>HR</th>
                        <th>SpO2</th>
                        <th>EtCO2</th>
                        <th>Temp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffLogDraft.vitalsGrid.map((row, idx) => (
                        <tr key={`vitals-${idx}`}>
                          <td><input type="time" value={row.time || ""} onChange={(e) => updateVitalsRow(idx, "time", e.target.value)} /></td>
                          <td><input value={row.bp || ""} onChange={(e) => updateVitalsRow(idx, "bp", e.target.value)} placeholder="120/80" /></td>
                          <td><input value={row.hr || ""} onChange={(e) => updateVitalsRow(idx, "hr", e.target.value)} /></td>
                          <td><input value={row.spo2 || ""} onChange={(e) => updateVitalsRow(idx, "spo2", e.target.value)} /></td>
                          <td><input value={row.etco2 || ""} onChange={(e) => updateVitalsRow(idx, "etco2", e.target.value)} /></td>
                          <td><input value={row.temp || ""} onChange={(e) => updateVitalsRow(idx, "temp", e.target.value)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="action-row">
                  <button type="button" onClick={() => setStaffLogDraft((prev) => ({ ...prev, vitalsGrid: [...prev.vitalsGrid, makeVitalsRow()] }))}>Add Vitals Row</button>
                </div>

                <h4>Fluid Balance Table (Cumulative I/O)</h4>
                <div className="table-wrap op-log-landscape">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Crystalloids (ml)</th>
                        <th>Colloids (ml)</th>
                        <th>Blood Products (ml)</th>
                        <th>EBL (ml)</th>
                        <th>Urine Output (ml)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffLogDraft.fluidBalance.map((row, idx) => (
                        <tr key={`fluid-${idx}`}>
                          <td><input type="time" value={row.time || ""} onChange={(e) => updateFluidRow(idx, "time", e.target.value)} /></td>
                          <td><input type="number" min="0" value={row.crystalloids || ""} onChange={(e) => updateFluidRow(idx, "crystalloids", e.target.value)} /></td>
                          <td><input type="number" min="0" value={row.colloids || ""} onChange={(e) => updateFluidRow(idx, "colloids", e.target.value)} /></td>
                          <td><input type="number" min="0" value={row.bloodProducts || ""} onChange={(e) => updateFluidRow(idx, "bloodProducts", e.target.value)} /></td>
                          <td><input type="number" min="0" value={row.ebl || ""} onChange={(e) => updateFluidRow(idx, "ebl", e.target.value)} /></td>
                          <td><input type="number" min="0" value={row.urineOutput || ""} onChange={(e) => updateFluidRow(idx, "urineOutput", e.target.value)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="action-row">
                  <button type="button" onClick={() => setStaffLogDraft((prev) => ({ ...prev, fluidBalance: [...prev.fluidBalance, makeFluidRow()] }))}>Add Fluid Row</button>
                </div>
                <div className="kpi-grid io-summary">
                  <div className="kpi"><strong>{fluidTotals.totalIn} ml</strong><span>Total In</span></div>
                  <div className="kpi"><strong>{fluidTotals.totalOut} ml</strong><span>Total Out</span></div>
                  <div className="kpi"><strong>{fluidTotals.balance} ml</strong><span>Total Balance (In-Out)</span></div>
                </div>

                <h4>Drug Log (Check + Time)</h4>
                <div className="table-wrap op-log-landscape">
                  <table>
                    <thead>
                      <tr>
                        <th>Given</th>
                        <th>Drug</th>
                        <th>Dose (mg)</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffLogDraft.drugLog.map((row, idx) => (
                        <tr key={`drug-${row.drug}-${idx}`}>
                          <td><input type="checkbox" checked={Boolean(row.checked)} onChange={(e) => updateDrugRow(idx, "checked", e.target.checked)} /></td>
                          <td>{row.drug}</td>
                          <td><input value={row.doseMg || ""} onChange={(e) => updateDrugRow(idx, "doseMg", e.target.value)} placeholder="___mg" /></td>
                          <td><input type="time" value={row.time || ""} onChange={(e) => updateDrugRow(idx, "time", e.target.value)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  </>
                )}

                {isAssignedNurse && (
                  <>
                <hr />
                <h4>Nursing Operation Summary Log</h4>
                <p className="muted">Standardized sterile count: initial, additional, final, with verbal verification before closure.</p>
                <div className="table-wrap op-log-landscape">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Initial Count</th>
                        <th>Additional Count</th>
                        <th>Final Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Sponge</td>
                        <td><input value={staffLogDraft.nursingSummary.sponge.initial || ""} onChange={(e) => updateCount("sponge", "initial", e.target.value)} /></td>
                        <td><input value={staffLogDraft.nursingSummary.sponge.additional || ""} onChange={(e) => updateCount("sponge", "additional", e.target.value)} /></td>
                        <td><input value={staffLogDraft.nursingSummary.sponge.final || ""} onChange={(e) => updateCount("sponge", "final", e.target.value)} /></td>
                      </tr>
                      <tr>
                        <td>Needle</td>
                        <td><input value={staffLogDraft.nursingSummary.needle.initial || ""} onChange={(e) => updateCount("needle", "initial", e.target.value)} /></td>
                        <td><input value={staffLogDraft.nursingSummary.needle.additional || ""} onChange={(e) => updateCount("needle", "additional", e.target.value)} /></td>
                        <td><input value={staffLogDraft.nursingSummary.needle.final || ""} onChange={(e) => updateCount("needle", "final", e.target.value)} /></td>
                      </tr>
                      <tr>
                        <td>Instrument</td>
                        <td><input value={staffLogDraft.nursingSummary.instrument.initial || ""} onChange={(e) => updateCount("instrument", "initial", e.target.value)} /></td>
                        <td><input value={staffLogDraft.nursingSummary.instrument.additional || ""} onChange={(e) => updateCount("instrument", "additional", e.target.value)} /></td>
                        <td><input value={staffLogDraft.nursingSummary.instrument.final || ""} onChange={(e) => updateCount("instrument", "final", e.target.value)} /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="form-grid">
                  <label><span>Scrub Nurse</span><input value={staffLogDraft.nursingSummary.verification.scrubNurse || ""} onChange={(e) => updateVerification("scrubNurse", e.target.value)} /></label>
                  <label><span>Circulating Nurse</span><input value={staffLogDraft.nursingSummary.verification.circulatingNurse || ""} onChange={(e) => updateVerification("circulatingNurse", e.target.value)} /></label>
                  <label><span>Confirmation Time</span><input type="datetime-local" value={staffLogDraft.nursingSummary.verification.confirmationTime || ""} onChange={(e) => updateVerification("confirmationTime", e.target.value)} /></label>
                  <label><span>Initial Count Confirmed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.verification.initialConfirmed)} onChange={(e) => updateVerification("initialConfirmed", e.target.checked)} /></label>
                  <label><span>Final Count Confirmed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.verification.finalConfirmed)} onChange={(e) => updateVerification("finalConfirmed", e.target.checked)} /></label>
                  <label><span>Verbal Confirmation Before Closure</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.verification.verbalConfirmation)} onChange={(e) => updateVerification("verbalConfirmation", e.target.checked)} /></label>
                </div>
                <label className="field">
                  <span>Nursing Notes</span>
                  <textarea rows={4} value={staffLogDraft.nursingSummary.notes || ""} onChange={(e) => setStaffLogDraft((prev) => ({ ...prev, nursingSummary: { ...prev.nursingSummary, notes: e.target.value } }))} />
                </label>
                <h4>WHO Surgical Safety Checklist (SSC)</h4>
                <div className="form-grid">
                  <label><span>Sign-In Completed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signIn?.completed)} onChange={(e) => updateWhoChecklist("signIn", "completed", e.target.checked)} /></label>
                  <label><span>Identity Confirmed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signIn?.patientIdentityConfirmed)} onChange={(e) => updateWhoChecklist("signIn", "patientIdentityConfirmed", e.target.checked)} /></label>
                  <label><span>Site/Procedure Confirmed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signIn?.siteAndProcedureConfirmed)} onChange={(e) => updateWhoChecklist("signIn", "siteAndProcedureConfirmed", e.target.checked)} /></label>
                  <label><span>Anesthesia Safety Check</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signIn?.anesthesiaSafetyCheckDone)} onChange={(e) => updateWhoChecklist("signIn", "anesthesiaSafetyCheckDone", e.target.checked)} /></label>
                  <label className="field"><span>Sign-In Notes</span><input value={staffLogDraft.nursingSummary.whoChecklist?.signIn?.notes || ""} onChange={(e) => updateWhoChecklist("signIn", "notes", e.target.value)} /></label>
                </div>
                <div className="form-grid">
                  <label><span>Time-Out Completed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.timeOut?.completed)} onChange={(e) => updateWhoChecklist("timeOut", "completed", e.target.checked)} /></label>
                  <label><span>Whole Team Present</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.timeOut?.teamPresent)} onChange={(e) => updateWhoChecklist("timeOut", "teamPresent", e.target.checked)} /></label>
                  <label><span>Patient/Site/Procedure Confirmed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.timeOut?.patientSiteProcedureConfirmed)} onChange={(e) => updateWhoChecklist("timeOut", "patientSiteProcedureConfirmed", e.target.checked)} /></label>
                  <label><span>Critical Steps Discussed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.timeOut?.criticalStepsDiscussed)} onChange={(e) => updateWhoChecklist("timeOut", "criticalStepsDiscussed", e.target.checked)} /></label>
                  <label><span>Concerns Discussed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.timeOut?.potentialConcernsDiscussed)} onChange={(e) => updateWhoChecklist("timeOut", "potentialConcernsDiscussed", e.target.checked)} /></label>
                  <label className="field"><span>Time-Out Notes</span><input value={staffLogDraft.nursingSummary.whoChecklist?.timeOut?.notes || ""} onChange={(e) => updateWhoChecklist("timeOut", "notes", e.target.value)} /></label>
                </div>
                <div className="form-grid">
                  <label><span>Sign-Out Completed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signOut?.completed)} onChange={(e) => updateWhoChecklist("signOut", "completed", e.target.checked)} /></label>
                  <label><span>Procedure Confirmed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signOut?.procedureConfirmed)} onChange={(e) => updateWhoChecklist("signOut", "procedureConfirmed", e.target.checked)} /></label>
                  <label><span>Counts Confirmed</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signOut?.sterileCountsConfirmed)} onChange={(e) => updateWhoChecklist("signOut", "sterileCountsConfirmed", e.target.checked)} /></label>
                  <label><span>Specimen Labeled</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signOut?.specimenLabeled)} onChange={(e) => updateWhoChecklist("signOut", "specimenLabeled", e.target.checked)} /></label>
                  <label><span>Equipment Problems Recorded</span><input type="checkbox" checked={Boolean(staffLogDraft.nursingSummary.whoChecklist?.signOut?.equipmentProblemsRecorded)} onChange={(e) => updateWhoChecklist("signOut", "equipmentProblemsRecorded", e.target.checked)} /></label>
                  <label className="field"><span>Sign-Out Notes</span><input value={staffLogDraft.nursingSummary.whoChecklist?.signOut?.notes || ""} onChange={(e) => updateWhoChecklist("signOut", "notes", e.target.value)} /></label>
                </div>
                <h4>Nursing Documentation Focus</h4>
                <div className="form-grid">
                  <label><span>Patient Positioning</span><input value={staffLogDraft.nursingSummary.focusEvents?.patientPositioning || ""} onChange={(e) => updateFocusEvent("patientPositioning", e.target.value)} /></label>
                  <label><span>Skin Preparation</span><input value={staffLogDraft.nursingSummary.focusEvents?.skinPreparation || ""} onChange={(e) => updateFocusEvent("skinPreparation", e.target.value)} /></label>
                  <label><span>Monitoring Devices Applied</span><input value={staffLogDraft.nursingSummary.focusEvents?.monitoringDevicesApplied || ""} onChange={(e) => updateFocusEvent("monitoringDevicesApplied", e.target.value)} /></label>
                </div>
                <label className="field">
                  <span>Significant Intra-Op Events</span>
                  <textarea rows={3} value={staffLogDraft.nursingSummary.focusEvents?.significantIntraOpEvents || ""} onChange={(e) => updateFocusEvent("significantIntraOpEvents", e.target.value)} />
                </label>
                  </>
                )}

                <button type="button" onClick={saveStaffOperationLog} disabled={Boolean(staffActiveCase?.caseLocked)}>Save Operation Log</button>
                {(isAssignedAnesthesiologist || isAssignedNurse) && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <h4>{isAssignedAnesthesiologist ? "Anesthesiologist Operative Report" : "Nurse Operative Report"}</h4>
                    {staffActiveCase?.caseLocked && <p className="muted">Case is closed. Report is read-only.</p>}
                    <p className="muted">Report is prefilled from your logged operation data. You can edit before submitting.</p>
                    <div className="action-row">
                      <button type="button" onClick={syncRoleReportFromLog} disabled={Boolean(staffActiveCase?.caseLocked)}>Refresh From Logs</button>
                    </div>
                    <label className="field">
                      <span>Operative Report</span>
                      <textarea
                        rows={12}
                        value={staffRoleReport.report}
                        onChange={(e) => setStaffRoleReport((prev) => ({ ...prev, report: e.target.value }))}
                        disabled={Boolean(staffActiveCase?.caseLocked)}
                      />
                    </label>
                    <label className="field">
                      <span>Remarks</span>
                      <textarea
                        rows={4}
                        value={staffRoleReport.remarks}
                        onChange={(e) => setStaffRoleReport((prev) => ({ ...prev, remarks: e.target.value }))}
                        disabled={Boolean(staffActiveCase?.caseLocked)}
                      />
                    </label>
                    <button type="button" onClick={submitStaffRoleReport} disabled={Boolean(staffActiveCase?.caseLocked)}>Submit Role Report</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {user?.role === "surgeon" && (
        <div className="panel-grid">
          <div className="panel">
            <h3>Request Surgery</h3>
            <form className="form-grid" onSubmit={submitSurgeryRequest}>
              <label>Procedure Template<select value={requestForm.templateId} onChange={(e) => applyProcedureTemplate(e.target.value)}><option value="">Select</option>{PROCEDURE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
              <label>Patient (Master List)<select value={requestForm.selectedPatientId} onChange={(e) => setRequestPatient(e.target.value)}><option value="">Select</option>{patients.map((p) => <option key={p._id} value={p._id}>{p.name} | {p.mrn}</option>)}</select></label>
              <label>Patient Name<input value={requestForm.patientName} onChange={(e) => setRequestForm({ ...requestForm, patientName: e.target.value })} required /></label>
              <label>Age<input type="number" min="0" value={requestForm.patientAge} onChange={(e) => setRequestForm({ ...requestForm, patientAge: e.target.value })} required /></label>
              <label>Gender<select value={requestForm.patientGender} onChange={(e) => setRequestForm({ ...requestForm, patientGender: e.target.value })}><option>Male</option><option>Female</option><option>Other</option></select></label>
              <label>MRN<input value={requestForm.patientMrn} onChange={(e) => setRequestForm({ ...requestForm, patientMrn: e.target.value })} required /></label>
              <label>Surgery Name<input value={requestForm.procedureName} onChange={(e) => setRequestForm({ ...requestForm, procedureName: e.target.value })} required /></label>
              <label>Side<select value={requestForm.side} onChange={(e) => setRequestForm({ ...requestForm, side: e.target.value })}><option>Left</option><option>Right</option><option>Bilateral</option><option>N/A</option></select></label>
              <label>Preferred Start<input type="datetime-local" value={requestForm.preferredStartTime} onChange={(e) => setRequestForm({ ...requestForm, preferredStartTime: e.target.value })} required /></label>
              <label>Estimated Duration (min)<input type="number" min="15" value={requestForm.estimatedDurationMinutes} onChange={(e) => setRequestForm({ ...requestForm, estimatedDurationMinutes: e.target.value })} required /></label>
              <label>Urgency<select value={requestForm.urgency} onChange={(e) => setRequestForm({ ...requestForm, urgency: e.target.value })}><option>Elective</option><option>Urgent</option><option>Emergency</option></select></label>
              <label>Standard Tray<input value={requestForm.standardTray} onChange={(e) => setRequestForm({ ...requestForm, standardTray: e.target.value })} placeholder="Knee Prosthesis Set, Implant Guide" /></label>
              <label>Special Materials<input value={requestForm.specialMaterials} onChange={(e) => setRequestForm({ ...requestForm, specialMaterials: e.target.value })} placeholder="Prosthetic Brand X" /></label>
              <label>Special Drugs<input value={requestForm.specialDrugs} onChange={(e) => setRequestForm({ ...requestForm, specialDrugs: e.target.value })} /></label>
              <label>Required HVAC<input value={requestForm.requiredHvac} onChange={(e) => setRequestForm({ ...requestForm, requiredHvac: e.target.value })} placeholder="Laminar Flow" /></label>
              <label>Anesthesia Preference<input value={requestForm.anesthesiaPreference} onChange={(e) => setRequestForm({ ...requestForm, anesthesiaPreference: e.target.value })} placeholder="General preferred due history" /></label>
              <button type="submit">Submit Request</button>
            </form>
            {requestConflict && (
              <p className="error">Potential conflict with your scheduled case: {requestConflict.caseId} ({formatTime(requestConflict.schedule?.plannedStartTime)} - {formatTime(requestConflict.schedule?.plannedEndTime)})</p>
            )}
          </div>

          <div className="panel">
            <h3>My Active Requests</h3>
            {surgeonActiveRequests.length === 0 && <p className="muted">No active requests.</p>}
            {surgeonActiveRequests.map((r) => {
              const linkedProc = getLinkedProcedureForRequest(r);
              const arrangement = linkedProc?.arrangement || {};
              const gapItems = arrangement.gapItems || r?.assignment?.gapItems || [];
              const alternativesApplied = arrangement.alternativesApplied || r?.assignment?.mobileMovePlan || [];
              const ackStatus = arrangement.surgeonAckStatus || (alternativesApplied.length || gapItems.length ? "Pending" : "NotRequired");
              const canReviewArrangement = Boolean(linkedProc && !linkedProc.caseLocked && (ackStatus === "Pending" || ackStatus === "ChangeRequested"));
              return (
                <article key={r._id} className="monitor-card">
                  <p><strong>{r.requestCode}</strong> | {r.procedure?.procedureName} ({r.procedure?.side})</p>
                  <p>Status: {r.status === "Under-Review" ? "Processing" : r.status}</p>
                  <p>Preferred: {formatTime(r.preferredStartTime)} | Duration: {r.procedure?.estimatedDurationMinutes || "-"} min</p>
                  {(r.status === "Scheduled" && (alternativesApplied.length > 0 || gapItems.length > 0)) && (
                    <p>Arrangement Review: {ackStatus}</p>
                  )}
                  {canReviewArrangement && (
                    <div className="action-row">
                      <button onClick={() => acknowledgeArrangement(linkedProc._id)}>Acknowledge Arrangement</button>
                      <button onClick={() => requestArrangementChange(linkedProc._id)}>Request Change</button>
                    </div>
                  )}
                  {r.status === "Scheduled" && (
                    <p className="muted">This case will appear in Personal Surgical Calendar after acknowledgment.</p>
                  )}
                  {r.rejectionReason && <p className="error">Rejected: {r.rejectionReason}</p>}
                </article>
              );
            })}
          </div>

          <div className="panel">
            <h3>Personal Surgical Calendar</h3>
            {personalSurgicalCases.length === 0 && <p className="muted">No active cases. Closed cases are available in Procedures.</p>}
            {personalSurgicalCases.map((item) => (
              <article key={item._id} className="monitor-card">
                {(() => {
                  const nextStep = getNextRequiredStep(item);
                  const canMarkReady = nextStep === "ready";
                  const canTimeOut = nextStep === "timeout";
                  const canClose = nextStep === "closed";
                  return (
                    <>
                <p><strong>{item.caseId}</strong> {item.title}</p>
                <p>{item.otRoomId?.otCode} | {formatTime(item.schedule?.plannedStartTime)} | {item.status}{item.caseLocked ? " | Locked" : ""}</p>
                {(() => {
                  const linkedReq = scheduledRequestByCaseId.get(item.caseId);
                  const arrangement = item.arrangement || {};
                  const gapItems = (arrangement.gapItems || linkedReq?.assignment?.gapItems || []);
                  const alternativesApplied = (arrangement.alternativesApplied || linkedReq?.assignment?.mobileMovePlan || []);
                  const ackStatus = arrangement.surgeonAckStatus || (alternativesApplied.length || gapItems.length ? "Pending" : "NotRequired");
                  const showArrangement = Boolean(
                    arrangement.requiresSurgeonAck ||
                    gapItems.length ||
                    alternativesApplied.length ||
                    ackStatus !== "NotRequired"
                  );
                  if (!showArrangement) return null;
                  return (
                  <div className="card">
                    <p>
                      <strong>Arrangement Review:</strong> {ackStatus}
                    </p>
                    {gapItems.length > 0 && (
                      <p>Missing (handled): {gapItems.join(", ")}</p>
                    )}
                    {alternativesApplied.length > 0 && (
                      <p>
                        Alternatives Applied: {alternativesApplied.map((a) => `${a.alternative} for ${a.missing}`).join("; ")}
                      </p>
                    )}
                    {ackStatus === "ChangeRequested" && arrangement?.changeRequestReason && (
                      <p className="error">Requested Change: {arrangement.changeRequestReason}</p>
                    )}
                    {(ackStatus === "Pending" || ackStatus === "ChangeRequested") && !item.caseLocked && (
                      <div className="action-row">
                        <button onClick={() => acknowledgeArrangement(item._id)}>Acknowledge Arrangement</button>
                        <button onClick={() => requestArrangementChange(item._id)}>Request Change</button>
                      </div>
                    )}
                  </div>
                  );
                })()}
                <div className="action-row">
                  <button onClick={() => openCase(item)}>Open Case</button>
                  <button
                    disabled={
                      item.caseLocked ||
                      ["Completed", "Cancelled"].includes(item.status) ||
                      !canTimeOut
                    }
                    onClick={() => surgeonTimeOut(item._id)}
                  >
                    Time-Out
                  </button>
                  <button
                    disabled={
                      item.caseLocked ||
                      ["Completed", "Cancelled"].includes(item.status) ||
                      !canMarkReady
                    }
                    onClick={() => markReady(item._id)}
                  >
                    Mark Ready
                  </button>
                  <button disabled={item.caseLocked || ["Completed", "Cancelled"].includes(item.status)} onClick={() => sendSpecialRequest(item._id)}>Special Request</button>
                  <button
                    disabled={item.caseLocked || !canClose}
                    onClick={() => closeCase(item._id)}
                  >
                    Close Case
                  </button>
                </div>
                <OperationWorkflow item={item} />
                {item.caseLocked && <p className="muted">Case is locked. Only viewing is allowed.</p>}
                    </>
                  );
                })()}
              </article>
            ))}
          </div>

          <div className="panel transcription-panel" ref={transcriptionPanelRef}>
            <h3>Transcription Module + Preference Cards</h3>
            {activeCase ? (
              <p className="muted">
                Editing: <strong>{activeCase.caseId}</strong> | {activeCase.otRoomId?.otCode} | {activeCase.status}{activeCase.caseLocked ? " | Locked" : ""}
              </p>
            ) : (
              <p className="muted">Select a case from Personal Surgical Calendar or open one from Procedures.</p>
            )}
            {activeCase && (
              <>
                <label className="field"><span>Operative Report</span><textarea className="report-area" rows={14} value={report} onChange={(e) => setReport(e.target.value)} disabled={!activeId || Boolean(activeCase?.caseLocked)} /></label>
                <label className="field"><span>Doctor Remarks</span><textarea className="remarks-area" rows={8} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!activeId || Boolean(activeCase?.caseLocked)} /></label>
                <button onClick={saveReport} disabled={!activeId || Boolean(activeCase?.caseLocked)}>Save Operative Report</button>
                <hr />
              </>
            )}
            <h4>Preference Card Manager</h4>
            <label className="field"><span>Procedure Type</span><input value={prefDraft.procedureType} onChange={(e) => setPrefDraft({ ...prefDraft, procedureType: e.target.value })} /></label>
            <label className="field"><span>Standard Materials</span><input value={prefDraft.materials} onChange={(e) => setPrefDraft({ ...prefDraft, materials: e.target.value })} placeholder="Knee Prosthesis Set,Implant Guide" /></label>
            <button onClick={savePreferenceCard}>Save Card</button>
            <ul>
              {prefs.map((p) => <li key={p.procedureType}>{p.procedureType}: {(p.materials || []).map((m) => m.name).join(", ")}</li>)}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

