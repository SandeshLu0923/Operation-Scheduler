import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client.js";
import FormField from "../components/FormField.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", roleType: "nurse" });
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const roleMap = {
        surgeon: { role: "surgeon" },
        nurse: { role: "ot_staff", staffRole: "Nurse" },
        anesthesiologist: { role: "ot_staff", staffRole: "Anesthesiologist" }
      };
      const payload = {
        name: form.name,
        email: form.email,
        password: form.password,
        ...roleMap[form.roleType]
      };
      const { data } = await api.post("/auth/register", payload);
      login(data);
      navigate("/calendar");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    }
  }

  return (
    <section className="card">
      <h2>Register</h2>
      <form onSubmit={onSubmit}>
        <FormField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <FormField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <FormField label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <label className="field">
          <span>Operational Role</span>
          <select value={form.roleType} onChange={(e) => setForm({ ...form, roleType: e.target.value })}>
            <option value="surgeon">Surgeon</option>
            <option value="nurse">Nurse</option>
            <option value="anesthesiologist">Anesthesiologist</option>
          </select>
        </label>
        <button type="submit">Register</button>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
