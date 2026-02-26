import { useEffect, useMemo, useState } from "react";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";

export default function ReportsPage() {
  const { user } = useAuth();
  const [sla, setSla] = useState(null);
  const [heatmap, setHeatmap] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [turnover, setTurnover] = useState({ avgGapMinutes: 0, gaps: [] });
  const [procedures, setProcedures] = useState([]);
  const [error, setError] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function loadAdminReports() {
    const [slaRes, heatRes, matRes] = await Promise.all([
      api.get("/reports/sla"),
      api.get(`/reports/analytics/heatmap?date=${date}`),
      api.get("/reports/analytics/material-readiness")
    ]);
    setSla(slaRes.data);
    setHeatmap(heatRes.data || []);
    setMaterials(matRes.data.uniqueMaterials || []);
    try {
      const gapRes = await api.get("/reports/analytics/turnover-gap");
      setTurnover(gapRes.data || { avgGapMinutes: 0, gaps: [] });
    } catch {
      setTurnover({ avgGapMinutes: 0, gaps: [] });
    }
  }

  async function loadProcedures() {
    const { data } = await api.get("/procedures?limit=300");
    setProcedures(data.items || []);
  }

  useEffect(() => {
    (async () => {
      try {
        await loadProcedures();
        if (user?.role === "ot_admin") await loadAdminReports();
      } catch {
        setError("Failed to load reports");
      }
    })();
  }, [user?.role, date]);

  const historical = useMemo(
    () => procedures.filter((p) => {
      const d = p.documentation || {};
      return Boolean(
        d.operativeReport ||
        d.nurseOperativeReport ||
        d.anesthesiologistOperativeReport ||
        d.combinedArchiveReport ||
        d.surgeonRemarks ||
        d.nurseRemarks ||
        d.anesthesiologistRemarks
      );
    }),
    [procedures]
  );

  return (
    <section>
      <h2>Reports</h2>
      {error && <p className="error">{error}</p>}

      {user?.role === "ot_admin" && (
        <>
          <div className="panel">
            <h3>Efficiency Analytics</h3>
            {sla && (
              <div className="kpi-grid">
                <div className="kpi"><strong>{sla.totalCases}</strong><span>Total</span></div>
                <div className="kpi"><strong>{sla.onTimeStartRate}%</strong><span>On-Time</span></div>
                <div className="kpi"><strong>{sla.delayRate}%</strong><span>Delay</span></div>
                <div className="kpi"><strong>{sla.avgPlannedDuration}</strong><span>Planned</span></div>
                <div className="kpi"><strong>{sla.avgActualDuration}</strong><span>Actual</span></div>
              </div>
            )}
            <p className="muted">Average Turnover Gap: {turnover.avgGapMinutes} minutes</p>
            <p className="muted">
              Covers case volume, start-time discipline, delay/cancellation pressure, planned-vs-actual duration drift, and cleaning/turnover pacing.
            </p>
          </div>

          <div className="panel">
            <h3>OT Utilization Trend</h3>
            <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={heatmap} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="otCode" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <ReferenceLine y={80} stroke="#d97a2b" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="utilizationPercent"
                  name="Utilization %"
                  stroke="#2e9c7a"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="muted">Target line at 80% helps quickly spot overbooked and underused rooms.</p>
          </div>

          <div className="panel">
            <h3>Material Forecast (Next 24h)</h3>
            <ul>
              {materials.map((m) => <li key={m.name}>{m.name}: {m.quantity}</li>)}
            </ul>
          </div>
        </>
      )}

      <div className="panel">
        <h3>Historical Archive</h3>
        {historical.length === 0 && <p className="muted">No reports submitted yet.</p>}
        {historical.length > 0 && (
          <ul>
            {historical.map((h) => (
              <li key={h._id}>
                {h.caseId} | {h.status}
                {" - "}
                {h.documentation?.combinedArchiveReport
                  ? "Combined report archived"
                  : h.documentation?.operativeReport
                    ? "Surgeon report submitted"
                    : h.documentation?.nurseOperativeReport
                      ? "Nurse report submitted"
                      : h.documentation?.anesthesiologistOperativeReport
                        ? "Anesthesiologist report submitted"
                        : "Remarks only"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
