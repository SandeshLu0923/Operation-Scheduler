import { useEffect, useState } from "react";
import api from "../api/client.js";

const GENERAL_BASELINE_ITEMS = [
  { name: "Suction Set", quantity: 8 },
  { name: "Cautery Pencil", quantity: 8 },
  { name: "Surgical Drapes", quantity: 20 },
  { name: "Suture Pack", quantity: 25 },
  { name: "IV Set", quantity: 20 },
  { name: "Knee Prosthesis Set", quantity: 6 },
  { name: "Implant Guide", quantity: 6 },
  { name: "Titanium Mesh", quantity: 4 },
  { name: "Harmonic Scalpel Unit", quantity: 4 }
];

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function OTCard({ ot, onSave, onViewSchedule }) {
  const [form, setForm] = useState({
    roomName: ot.roomName || "",
    location: ot.location || "",
    primarySpecialization: (ot.primarySpecialization || []).join(", "),
    fixedInfrastructure: (ot.fixedInfrastructure || []).join(", "),
    capabilities: (ot.capabilities || []).join(", "),
    functionality: ot.functionality || ""
  });
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isViewingDetails, setIsViewingDetails] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [schedule, setSchedule] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  useEffect(() => {
    setForm({
      roomName: ot.roomName || "",
      location: ot.location || "",
      primarySpecialization: (ot.primarySpecialization || []).join(", "),
      fixedInfrastructure: (ot.fixedInfrastructure || []).join(", "),
      capabilities: (ot.capabilities || []).join(", "),
      functionality: ot.functionality || ""
    });
  }, [ot]);

  async function save() {
    setSaving(true);
    await onSave(ot._id, {
      roomName: form.roomName,
      location: form.location,
      primarySpecialization: splitList(form.primarySpecialization),
      fixedInfrastructure: splitList(form.fixedInfrastructure),
      capabilities: splitList(form.capabilities),
      functionality: form.functionality
    });
    setIsEditing(false);
    setSaving(false);
  }

  async function viewSchedule() {
    setShowSchedulePanel(true);
    setScheduleLoading(true);
    const data = await onViewSchedule(ot._id, scheduleDate);
    setSchedule(data || null);
    setScheduleLoading(false);
  }

  return (
    <div className="panel">
      <div className="action-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3>{ot.otCode}</h3>
        <div className="action-row">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={!isViewingDetails || isEditing}
            title={!isViewingDetails ? "Click View first to open full details" : ""}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setIsEditing(false);
              setIsViewingDetails(true);
            }}
          >
            View
          </button>
        </div>
      </div>
      {isViewingDetails && !isEditing && (
        <ul>
          <li><strong>Room Name:</strong> {form.roomName || "-"}</li>
          <li><strong>Location:</strong> {form.location || "-"}</li>
          <li><strong>Primary Specialization:</strong> {form.primarySpecialization || "-"}</li>
          <li><strong>Fixed Infrastructure:</strong> {form.fixedInfrastructure || "-"}</li>
          <li><strong>Capabilities:</strong> {form.capabilities || "-"}</li>
          <li><strong>Functionality:</strong> {form.functionality || "-"}</li>
        </ul>
      )}
      {isViewingDetails && isEditing && (
        <div className="form-grid">
          <label>Room Name<input value={form.roomName} onChange={(e) => setForm({ ...form, roomName: e.target.value })} readOnly={!isEditing} /></label>
          <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} readOnly={!isEditing} /></label>
          <label>Primary Specialization<input value={form.primarySpecialization} onChange={(e) => setForm({ ...form, primarySpecialization: e.target.value })} placeholder="Urology, Gynecology" readOnly={!isEditing} /></label>
          <label>Fixed Infrastructure<input value={form.fixedInfrastructure} onChange={(e) => setForm({ ...form, fixedInfrastructure: e.target.value })} placeholder="Fixed DaVinci Robotic Console" readOnly={!isEditing} /></label>
          <label>Capabilities<input value={form.capabilities} onChange={(e) => setForm({ ...form, capabilities: e.target.value })} placeholder="Robotic, General" readOnly={!isEditing} /></label>
          <label>Functionality<input value={form.functionality} onChange={(e) => setForm({ ...form, functionality: e.target.value })} readOnly={!isEditing} /></label>
        </div>
      )}
      <div className="action-row">
        {isEditing && isViewingDetails && <button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save OT DNA"}</button>}
        <button type="button" onClick={viewSchedule} disabled={scheduleLoading}>
          {scheduleLoading ? "Loading..." : "View Schedule"}
        </button>
      </div>
      {showSchedulePanel && (
        <label className="field" style={{ maxWidth: 220 }}>
          <span>Schedule Date</span>
          <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
        </label>
      )}
      {showSchedulePanel && schedule && (
        <div className="card">
          <p><strong>{schedule.otCode}</strong> schedule for {new Date(schedule.date || scheduleDate).toLocaleDateString()}</p>
          {schedule.bookings?.length ? (
            <ul>
              {schedule.bookings.map((b) => (
                <li key={b._id}>
                  {b.caseId} | {new Date(b.schedule?.plannedStartTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {" - "}
                  {new Date(b.schedule?.plannedEndTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} | {b.status}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No bookings for this OT on selected date.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function OTBlueprintPage() {
  const [ots, setOts] = useState([]);
  const [mobile, setMobile] = useState([]);
  const [pending, setPending] = useState([]);
  const [newItem, setNewItem] = useState({ name: "", quantity: 1 });
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  async function load() {
    const [otRes, mobileRes, reqRes] = await Promise.all([
      api.get("/admin/ots"),
      api.get("/admin/mobile-equipment"),
      api.get("/requests?status=Pending")
    ]);
    setOts(otRes.data || []);
    setMobile(mobileRes.data || []);
    setPending(reqRes.data || []);
  }

  useEffect(() => {
    load().catch(() => setError("Failed to load OT blueprint data"));
  }, []);

  async function saveOt(id, payload) {
    try {
      await api.patch(`/admin/ots/${id}`, payload);
      setToast("OT updated");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update OT");
    }
  }

  async function saveMobile(id, payload) {
    try {
      await api.patch(`/admin/mobile-equipment/${id}`, payload);
      setToast("Mobile pool updated");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update equipment");
    }
  }

  async function addMobileItem() {
    try {
      await api.post("/admin/mobile-equipment", {
        name: newItem.name,
        quantity: Number(newItem.quantity || 0)
      });
      setNewItem({ name: "", quantity: 1 });
      setToast("Mobile equipment added");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to add equipment");
    }
  }

  async function applyGeneralInventory() {
    try {
      const { data } = await api.post("/admin/ots/apply-general-inventory", { force: false });
      setToast(`General inventory applied to ${data.updated}/${data.total} OTs`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to apply general inventory");
    }
  }

  async function forceBaselineOverwrite() {
    const ok = window.confirm("This will reset baseline item quantities in all OTs. Continue?");
    if (!ok) return;
    try {
      const { data } = await api.post("/admin/ots/apply-general-inventory", { force: true });
      setToast(`Baseline overwrite applied to ${data.updated}/${data.total} OTs`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to force baseline overwrite");
    }
  }

  async function viewOtSchedule(otId, dateValue) {
    try {
      const { data } = await api.get(`/admin/ots/${otId}/schedule`, { params: { date: dateValue } });
      return data || null;
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load OT schedule");
      return null;
    }
  }

  return (
    <section>
      <h2>OT Blueprint</h2>
      {toast && <div className="toast">{toast}</div>}
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <div className="action-row" style={{ marginBottom: 10 }}>
          <button onClick={applyGeneralInventory}>Apply General Inventory To All OTs</button>
          <button onClick={forceBaselineOverwrite}>Force Baseline Overwrite</button>
        </div>
        <p className="muted">Baseline items are the default minimum stock each OT should have for common surgeries.</p>
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Baseline Item</th>
                <th>Default Qty</th>
              </tr>
            </thead>
            <tbody>
              {GENERAL_BASELINE_ITEMS.map((item) => (
                <tr key={item.name}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Mobile Equipment Pool</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {mobile.map((item) => (
                <tr key={item._id}>
                  <td>{item.name}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={item.quantity}
                      onChange={(e) => setMobile((prev) => prev.map((x) => (x._id === item._id ? { ...x, quantity: Number(e.target.value) } : x)))}
                      style={{ maxWidth: 90 }}
                    />
                  </td>
                  <td><button onClick={() => saveMobile(item._id, { quantity: item.quantity })}>Save</button></td>
                </tr>
              ))}
              <tr>
                <td><input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="New item name" /></td>
                <td><input type="number" min="0" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })} style={{ maxWidth: 90 }} /></td>
                <td><button onClick={addMobileItem} disabled={!newItem.name.trim()}>Add</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {ots.map((ot) => <OTCard key={ot._id} ot={ot} onSave={saveOt} onViewSchedule={viewOtSchedule} />)}

      <div className="panel">
        <h3>Suggestion Preview (Pending Requests)</h3>
        {pending.length === 0 && <p className="muted">No pending requests.</p>}
        {pending.map((r) => (
          <div key={r._id} className="monitor-card">
            <p><strong>{r.requestCode}</strong> | {r.procedure?.procedureName}</p>
            {r.suggestion?.best && (
              <p>Best Match: {r.suggestion.best.otCode} ({r.suggestion.best.compatibilityScore}%)</p>
            )}
            {r.suggestion?.best?.missingFixed?.length > 0 && (
              <p className="error">Gap: {r.suggestion.best.missingFixed.join(", ")}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
