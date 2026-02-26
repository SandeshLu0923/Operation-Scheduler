import { useEffect, useState } from "react";
import api from "../api/client.js";
import socket from "../api/realtime.js";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/admin/alerts?limit=300");
      setAlerts(data);
    } catch {
      setError("Failed to load alerts");
    }
  }

  async function resolveAlert(id) {
    try {
      await api.patch(`/admin/alerts/${id}/resolve`);
      await load();
    } catch {
      setError("Failed to resolve alert");
    }
  }

  useEffect(() => {
    load();
    const onAlert = () => load();
    socket.on("alert:new", onAlert);
    return () => socket.off("alert:new", onAlert);
  }, []);

  return (
    <section>
      <h2>System Alerts</h2>
      <p className="muted">Critical-path and operational alerts with resolution tracking.</p>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Severity</th>
              <th>Type</th>
              <th>Message</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a._id}>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.severity}</td>
                <td>{a.type}</td>
                <td>{a.message}</td>
                <td>{a.resolved ? `Resolved by ${a.resolvedBy?.name || "-"}` : "Open"}</td>
                <td>
                  {!a.resolved ? (
                    <button onClick={() => resolveAlert(a._id)}>Resolve</button>
                  ) : (
                    <span className="muted">Done</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
