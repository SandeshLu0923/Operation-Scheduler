import { useEffect, useState } from "react";
import api from "../api/client.js";

export default function AuditLogsPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/admin/audit-logs?limit=300");
      setRows(data);
    } catch {
      setError("Failed to load audit logs");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section>
      <h2>Audit Logs</h2>
      <p className="muted">Tracks who changed a surgery and when, including actions and metadata.</p>
      {error && <p className="error">{error}</p>}
      <div className="filters">
        <button onClick={load}>Refresh</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row._id}>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.actorId?.name || "System"}</td>
                <td>{row.actorRole || row.actorId?.role || "-"}</td>
                <td>{row.action}</td>
                <td>{row.entityType} ({row.entityId})</td>
                <td><pre className="meta-pre">{JSON.stringify(row.metadata || {}, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
