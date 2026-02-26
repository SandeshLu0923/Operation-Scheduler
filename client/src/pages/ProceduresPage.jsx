import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

function overlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

export default function ProceduresPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [ots, setOts] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  const [patients, setPatients] = useState([]);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [traumaForm, setTraumaForm] = useState({
    title: "Level 1 Trauma",
    procedureType: "Trauma",
    patientId: "",
    surgeon: "",
    assistantMedic: "",
    anesthesiologist: "",
    nurse: "",
    anesthesiaType: "General",
    estimatedDurationMinutes: 60,
    standardTray: "",
    materials: "",
    drugs: "",
    useBestOt: true,
    otRoomId: ""
  });

  async function load() {
    try {
      const tasks = [api.get("/procedures?limit=300")];
      if (user?.role === "ot_admin") {
        tasks.push(
          api.get("/admin/ots"),
          api.get("/admin/doctors"),
          api.get("/admin/personnel"),
          api.get("/admin/patients")
        );
      }
      const [procRes, otRes, docRes, perRes, patRes] = await Promise.all(tasks);
      setRows(procRes.data.items || []);
      setOts(otRes?.data || []);
      setDoctors(docRes?.data || []);
      setPersonnel(perRes?.data || []);
      setPatients(patRes?.data || []);
    } catch {
      setError("Failed to load procedures");
    }
  }

  useEffect(() => { load(); }, [user?.role]);

  const selectedProcedure = rows.find((r) => String(r._id) === String(selectedId)) || null;
  const anesthesiologists = useMemo(() => personnel.filter((p) => p.role === "Anesthesiologist"), [personnel]);
  const nurses = useMemo(() => personnel.filter((p) => p.role === "Nurse"), [personnel]);

  function pickBestOtId(startIso, durationMinutes) {
    const start = new Date(startIso);
    const end = new Date(start.getTime() + Number(durationMinutes || 0) * 60000);
    let best = null;

    for (const ot of ots) {
      if (ot.active === false) continue;
      const maintenanceHit = (ot.maintenanceBlocks || []).some(
        (b) => b?.active && overlap(start, end, b.startTime, b.endTime)
      );
      if (maintenanceHit) continue;

      const overlapping = rows.filter(
        (r) =>
          String(r.otRoomId?._id || r.otRoomId) === String(ot._id) &&
          !["Cancelled", "Completed"].includes(r.status) &&
          overlap(start, end, r.schedule?.plannedStartTime, r.schedule?.plannedEndTime)
      );
      const emergencyOverlaps = overlapping.filter((r) => r.priority === "Emergency").length;
      const nonEmergencyOverlaps = overlapping.filter((r) => r.priority !== "Emergency").length;
      const traumaFit = (ot.primarySpecialization || []).concat(ot.capabilities || []).join(" ").toLowerCase().includes("trauma")
        || (ot.primarySpecialization || []).concat(ot.capabilities || []).join(" ").toLowerCase().includes("general");
      const score = emergencyOverlaps * 100 + nonEmergencyOverlaps * 10 + (traumaFit ? -1 : 0);

      if (!best || score < best.score) {
        best = { otId: ot._id, score };
      }
    }

    return best?.otId || "";
  }

  function openSelectedCase() {
    if (!selectedProcedure) return;
    navigate(`/calendar?openCaseId=${selectedProcedure._id}`);
  }

  async function submitTrauma(e) {
    e.preventDefault();
    setError("");
    const stamp = Date.now().toString().slice(-5);
    const startTime = new Date().toISOString();
    const selectedOtId = traumaForm.useBestOt
      ? pickBestOtId(startTime, Number(traumaForm.estimatedDurationMinutes || 60))
      : traumaForm.otRoomId;

    if (!traumaForm.patientId || !traumaForm.surgeon || !traumaForm.anesthesiologist || !selectedOtId) {
      setError("Patient, surgeon, anesthesiologist and OT are required for trauma scheduling.");
      return;
    }

    try {
      await api.post("/procedures/emergency", {
        caseId: `TRAUMA-${stamp}`,
        title: traumaForm.title,
        procedureType: traumaForm.procedureType,
        patientId: traumaForm.patientId,
        otRoomId: selectedOtId,
        team: {
          surgeon: traumaForm.surgeon,
          assistantMedic: traumaForm.assistantMedic || null,
          anesthesiologist: traumaForm.anesthesiologist,
          anesthesiaType: traumaForm.anesthesiaType,
          nurses: traumaForm.nurse ? [traumaForm.nurse] : []
        },
        schedule: {
          startTime,
          estimatedDurationMinutes: Number(traumaForm.estimatedDurationMinutes || 60),
          anesthesiaPrepTimestamp: traumaForm.anesthesiaType === "General"
            ? new Date(Date.now() - 5 * 60000).toISOString()
            : null
        },
        resources: {
          standardTray: traumaForm.standardTray,
          materials: traumaForm.materials
            .split(/[;,]/)
            .map((m) => m.trim())
            .filter(Boolean)
            .map((name) => ({ name, quantity: 1 })),
          drugs: traumaForm.drugs
            .split(/[;,]/)
            .map((d) => d.trim())
            .filter(Boolean)
        },
        priority: "Emergency"
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Trauma scheduling failed");
    }
  }

  return (
    <section>
      <h2>Procedures</h2>
      {error && <p className="error">{error}</p>}
      {user?.role === "ot_admin" && (
        <div className="panel">
          <h3>Trauma Intake (Emergency Override)</h3>
          <form className="form-grid" onSubmit={submitTrauma}>
            <label>Title<input value={traumaForm.title} onChange={(e) => setTraumaForm({ ...traumaForm, title: e.target.value })} required /></label>
            <label>Procedure Type<input value={traumaForm.procedureType} onChange={(e) => setTraumaForm({ ...traumaForm, procedureType: e.target.value })} required /></label>
            <label>Patient<select value={traumaForm.patientId} onChange={(e) => setTraumaForm({ ...traumaForm, patientId: e.target.value })} required><option value="">Select</option>{patients.map((p) => <option key={p._id} value={p._id}>{p.name} | {p.mrn}</option>)}</select></label>
            <label>Lead Surgeon<select value={traumaForm.surgeon} onChange={(e) => setTraumaForm({ ...traumaForm, surgeon: e.target.value })} required><option value="">Select</option>{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
            <label>Assistant<select value={traumaForm.assistantMedic} onChange={(e) => setTraumaForm({ ...traumaForm, assistantMedic: e.target.value })}><option value="">None</option>{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
            <label>Anesthesiologist<select value={traumaForm.anesthesiologist} onChange={(e) => setTraumaForm({ ...traumaForm, anesthesiologist: e.target.value })} required><option value="">Select</option>{anesthesiologists.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
            <label>Lead Nurse<select value={traumaForm.nurse} onChange={(e) => setTraumaForm({ ...traumaForm, nurse: e.target.value })}><option value="">Select</option>{nurses.map((n) => <option key={n._id} value={n._id}>{n.name}</option>)}</select></label>
            <label>Anesthesia Type<select value={traumaForm.anesthesiaType} onChange={(e) => setTraumaForm({ ...traumaForm, anesthesiaType: e.target.value })}><option>General</option><option>Spinal</option><option>Local</option><option>MAC</option><option>Regional</option><option>Sedation</option></select></label>
            <label>Duration (min)<input type="number" min="15" value={traumaForm.estimatedDurationMinutes} onChange={(e) => setTraumaForm({ ...traumaForm, estimatedDurationMinutes: e.target.value })} required /></label>
            <label>Standard Tray<input value={traumaForm.standardTray} onChange={(e) => setTraumaForm({ ...traumaForm, standardTray: e.target.value })} /></label>
            <label>Materials<input value={traumaForm.materials} onChange={(e) => setTraumaForm({ ...traumaForm, materials: e.target.value })} placeholder="Titanium Mesh,Harmonic Scalpel" /></label>
            <label>Drugs<input value={traumaForm.drugs} onChange={(e) => setTraumaForm({ ...traumaForm, drugs: e.target.value })} /></label>
            <label>
              Auto-select Best OT
              <select value={traumaForm.useBestOt ? "yes" : "no"} onChange={(e) => setTraumaForm({ ...traumaForm, useBestOt: e.target.value === "yes" })}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            {!traumaForm.useBestOt && (
              <label>OT<select value={traumaForm.otRoomId} onChange={(e) => setTraumaForm({ ...traumaForm, otRoomId: e.target.value })} required><option value="">Select</option>{ots.map((o) => <option key={o._id} value={o._id}>{o.otCode}</option>)}</select></label>
            )}
            <button type="submit">Create Trauma Case</button>
          </form>
        </div>
      )}
      <div className="action-row" style={{ marginBottom: 12 }}>
        <button disabled={!selectedProcedure} onClick={openSelectedCase}>Open Case</button>
        {selectedProcedure && <p className="muted">Selected: {selectedProcedure.caseId}</p>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Operation ID</th>
              <th>Category</th>
              <th>OT</th>
              <th>Lead Surgeon</th>
              <th>Status</th>
              <th>Planned Start</th>
              <th>Duration</th>
              <th>Locked</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r._id}
                onClick={() => setSelectedId(r._id)}
                style={{
                  cursor: "pointer",
                  background: String(selectedId) === String(r._id) ? "rgba(46,156,122,0.15)" : "transparent"
                }}
              >
                <td>{r.caseId}</td>
                <td>{r.procedureType}</td>
                <td>{r.otRoomId?.otCode}</td>
                <td>{r.team?.surgeon?.name}</td>
                <td>{r.status}</td>
                <td>{new Date(r.schedule?.plannedStartTime).toLocaleString()}</td>
                <td>{r.schedule?.estimatedDurationMinutes || "-"}m</td>
                <td>{r.caseLocked ? "Yes" : "No"}</td>
                <td>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/calendar?openCaseId=${r._id}`);
                    }}
                  >
                    Open Case
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
