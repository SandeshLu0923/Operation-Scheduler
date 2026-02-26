import { useEffect, useMemo, useState } from "react";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

function formatTime(dt) {
  if (!dt) return "-";
  return new Date(dt).toLocaleString();
}

export default function RequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [openActiveId, setOpenActiveId] = useState("");
  const [openHistoryId, setOpenHistoryId] = useState("");

  async function loadData() {
    const tasks = [api.get("/requests"), api.get("/procedures?limit=300")];
    const [reqRes, procRes] = await Promise.all(tasks);
    setRequests(reqRes.data || []);
    setProcedures(procRes?.data?.items || []);
  }

  useEffect(() => {
    loadData().catch(() => setError("Failed to load requests"));
  }, [user?.role]);

  function requestResolutionContext(request) {
    const linkedProc = findLinkedProcedure(request);
    const scheduledProc = request?.scheduledProcedureId || {};
    const arrangement = linkedProc?.arrangement || scheduledProc?.arrangement || {};
    const arrangementChangeReason = String(arrangement?.changeRequestReason || "").trim();
    const requestChangeReason = String(request?.changeRequest?.reason || "").trim();
    const changeReason = requestChangeReason || arrangementChangeReason;
    const gapItems = arrangement.gapItems || request?.assignment?.gapItems || [];
    const alternativesApplied = arrangement.alternativesApplied || request?.assignment?.mobileMovePlan || [];
    const hasArrangementReview = Boolean(arrangement.requiresSurgeonAck || gapItems.length || alternativesApplied.length);
    const hasRequestChange = Boolean(changeReason);
    const ackStatus = hasRequestChange
      ? "ChangeRequested"
      : arrangement.surgeonAckStatus || (hasArrangementReview ? "Pending" : "NotRequired");
    const unresolvedScheduled = request?.status === "Scheduled" && (
      (linkedProc?.status === "Pending") ||
      (scheduledProc?.status === "Pending") ||
      hasRequestChange ||
      (hasArrangementReview && (ackStatus === "Pending" || ackStatus === "ChangeRequested"))
    );
    const isActive = ["Pending", "Under-Review"].includes(request?.status) || unresolvedScheduled;
    return { linkedProc, arrangement, gapItems, alternativesApplied, ackStatus, hasArrangementReview, isActive, hasRequestChange, changeReason };
  }

  const activeRequests = useMemo(() => requests.filter((r) => requestResolutionContext(r).isActive), [requests, procedures]);
  const respondedRequests = useMemo(() => requests.filter((r) => !requestResolutionContext(r).isActive), [requests, procedures]);
  const showSurgeonCol = user?.role === "ot_admin";
  const openedActive = activeRequests.find((r) => String(r._id) === String(openActiveId)) || null;
  const openedHistory = respondedRequests.find((r) => String(r._id) === String(openHistoryId)) || null;
  function adminStatusLabel(request) {
    const ctx = requestResolutionContext(request);
    if (ctx.hasRequestChange || ctx.ackStatus === "ChangeRequested") return "Change Requested";
    if (ctx.ackStatus === "Pending" && request?.status === "Scheduled") return "Pending Surgeon Review";
    if (request?.status === "Under-Review") return "Processed";
    if (request?.status === "Scheduled") return "Completed";
    return request?.status;
  }

  function findLinkedProcedure(request) {
    const scheduledId = request?.scheduledProcedureId?._id || request?.scheduledProcedureId || "";
    const scheduledCaseId = request?.scheduledProcedureId?.caseId || "";
    return procedures.find(
      (p) =>
        (scheduledId && String(p._id) === String(scheduledId)) ||
        (scheduledCaseId && String(p.caseId) === String(scheduledCaseId))
    ) || null;
  }

  async function acknowledgeArrangement(id) {
    try {
      await api.patch(`/procedures/${id}/acknowledge-arrangement`);
      setToast("Arrangement acknowledged");
      await loadData();
      setTimeout(() => setToast(""), 2500);
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
      await loadData();
      setTimeout(() => setToast(""), 2500);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to request arrangement change");
    }
  }

  async function requestSurgeryChange(id) {
    const reason = prompt("Reason for request change");
    if (!reason) return;
    try {
      await api.patch(`/requests/${id}/request-change`, { reason });
      setToast("Request change submitted to admin");
      await loadData();
      setTimeout(() => setToast(""), 2500);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit request change");
    }
  }

  function arrangementContext(request) {
    const { linkedProc, arrangement, gapItems, alternativesApplied, ackStatus, hasArrangementReview } = requestResolutionContext(request);
    const canReviewArrangement = Boolean(
      hasArrangementReview &&
      linkedProc &&
      !linkedProc.caseLocked &&
      (ackStatus === "Pending" || ackStatus === "ChangeRequested")
    );
    return { linkedProc, arrangement, gapItems, alternativesApplied, ackStatus, canReviewArrangement };
  }

  function RequestDetails({ request }) {
    if (!request) return null;
    const ctx = arrangementContext(request);
    const requestedChangeReason = requestResolutionContext(request).changeReason;
    const statusLabel = user?.role === "ot_admin" ? adminStatusLabel(request) : (request.status === "Under-Review" ? "Processed" : request.status);
    return (
      <div className="monitor-card">
        <p><strong>{request.requestCode}</strong> | {request.procedure?.procedureName} ({request.procedure?.side})</p>
        <p>Status: {statusLabel}</p>
        {showSurgeonCol && <p>Surgeon: {request.requestedBy?.name || "-"}</p>}
        <p>Patient: {request.patient?.name || "-"} | MRN: {request.patient?.mrn || "-"}</p>
        <p>Preferred: {formatTime(request.preferredStartTime)} | Duration: {request.procedure?.estimatedDurationMinutes || "-"} min | Urgency: {request.procedure?.urgency || "-"}</p>
        <p>Standard Tray: {(request.resources?.specialEquipment || []).join(", ") || "-"}</p>
        <p>Materials: {(request.resources?.specialMaterials || []).join(", ") || "-"}</p>
        <p>Drugs: {(request.resources?.specialDrugs || []).join(", ") || "-"}</p>
        {request.scheduledProcedureId?.caseId && <p>Scheduled Case: {request.scheduledProcedureId.caseId}</p>}
        {request.adminNotes && <p>Admin Notes: {request.adminNotes}</p>}
        {request.rejectionReason && <p className="error">Rejected: {request.rejectionReason}</p>}
        {user?.role === "ot_admin" && (
          <>
            <p>Arrangement Review: {ctx.ackStatus}</p>
            {ctx.gapItems.length > 0 && (
              <p className="muted">Gap Items: {ctx.gapItems.join(", ")}</p>
            )}
            {ctx.alternativesApplied.length > 0 && (
              <p className="muted">Applied Alternatives: {ctx.alternativesApplied.map((m) => `${m.alternative} for ${m.missing}`).join("; ")}</p>
            )}
            {requestedChangeReason && (
              <p className="error">Requested Change: {requestedChangeReason}</p>
            )}
          </>
        )}
        {user?.role === "surgeon" && (
          <>
            <p>Arrangement Review: {ctx.ackStatus}</p>
            {requestedChangeReason && <p className="error">Requested Change: {requestedChangeReason}</p>}
            {ctx.alternativesApplied.length > 0 && (
              <p>Alternatives: {ctx.alternativesApplied.map((m) => `${m.alternative} for ${m.missing}`).join("; ")}</p>
            )}
            {request?.status === "Scheduled" && !ctx.linkedProc && (
              <p className="muted">Scheduled case link is not loaded yet. Refresh and open again.</p>
            )}
            {["Pending", "Under-Review"].includes(request?.status) && (
              <div className="action-row">
                <button onClick={() => requestSurgeryChange(request._id)}>Request Change</button>
              </div>
            )}
            {ctx.canReviewArrangement && (
              <div className="action-row">
                <button onClick={() => acknowledgeArrangement(ctx.linkedProc._id)}>Acknowledge</button>
                <button onClick={() => requestArrangementChange(ctx.linkedProc._id)}>Request Change</button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <section>
      <h2>Requests</h2>
      {toast && <div className="toast">{toast}</div>}
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <h3>{user?.role === "ot_admin" ? "Active Requests Queue" : "Active Requests"}</h3>
        {activeRequests.length === 0 && <p className="muted">No active requests.</p>}
        {activeRequests.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Procedure</th>
                  <th>Status</th>
                  {showSurgeonCol && <th>Surgeon</th>}
                  {showSurgeonCol && <th>Requested Change</th>}
                  <th>Preferred</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {activeRequests.map((r) => {
                  const requestedChangeReason = requestResolutionContext(r).changeReason;
                  return (
                    <tr key={r._id}>
                      <td>{r.requestCode}</td>
                      <td>{r.procedure?.procedureName} ({r.procedure?.side})</td>
                      <td>{adminStatusLabel(r)}</td>
                      {showSurgeonCol && <td>{r.requestedBy?.name || "-"}</td>}
                      {showSurgeonCol && <td>{requestedChangeReason || "-"}</td>}
                      <td>{formatTime(r.preferredStartTime)}</td>
                      <td><button onClick={() => setOpenActiveId(r._id)}>{String(openActiveId) === String(r._id) ? "Opened" : "Open"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {openedActive && <RequestDetails request={openedActive} />}
      </div>

      <div className="panel">
        <h3>Request Responses & History</h3>
        {respondedRequests.length === 0 && <p className="muted">No responded requests yet.</p>}
        {respondedRequests.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Procedure</th>
                  <th>Status</th>
                  {showSurgeonCol && <th>Surgeon</th>}
                  {showSurgeonCol && <th>Requested Change</th>}
                  <th>Preferred</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {respondedRequests.map((r) => {
                  const requestedChangeReason = requestResolutionContext(r).changeReason;
                  return (
                    <tr key={r._id}>
                      <td>{r.requestCode}</td>
                      <td>{r.procedure?.procedureName} ({r.procedure?.side})</td>
                      <td>{adminStatusLabel(r)}</td>
                      {showSurgeonCol && <td>{r.requestedBy?.name || "-"}</td>}
                      {showSurgeonCol && <td>{requestedChangeReason || "-"}</td>}
                      <td>{formatTime(r.preferredStartTime)}</td>
                      <td><button onClick={() => setOpenHistoryId(r._id)}>{String(openHistoryId) === String(r._id) ? "Opened" : "Open"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {openedHistory && <RequestDetails request={openedHistory} />}
      </div>
    </section>
  );
}
