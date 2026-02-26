import { useAuth } from "../context/AuthContext.jsx";

export default function HomePage() {
  const { user } = useAuth();

  return (
    <section className="hero">
      <h1>Dynamic OT Scheduler</h1>
      <p>Calculated-state operation workflow with role-specific dashboards for OT Admin, Surgeon, and OT Staff.</p>
      {user ? (
        <p>Open <strong>/calendar</strong> to begin today's workflow.</p>
      ) : (
        <p>Login to access your role dashboard.</p>
      )}
    </section>
  );
}
