import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import api from "../api/client.js";
import socket from "../api/realtime.js";

const roleLabel = {
  ot_admin: "OT Admin",
  surgeon: "Surgeon",
  ot_staff: "OT Staff"
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [openAlertCount, setOpenAlertCount] = useState(0);

  useEffect(() => {
    if (user?.role !== "ot_admin") {
      setOpenAlertCount(0);
      return undefined;
    }

    let mounted = true;
    const loadCount = async () => {
      try {
        const { data } = await api.get("/admin/alerts?limit=300");
        if (!mounted) return;
        setOpenAlertCount(data.filter((item) => !item.resolved).length);
      } catch {
        if (mounted) setOpenAlertCount(0);
      }
    };

    const onAlert = () => loadCount();
    loadCount();
    socket.on("alert:new", onAlert);
    const timer = setInterval(loadCount, 30000);

    return () => {
      mounted = false;
      clearInterval(timer);
      socket.off("alert:new", onAlert);
    };
  }, [user?.role, location.pathname]);

  const navItems = useMemo(() => {
    if (!user) return [];
    const base = [
      { to: "/calendar", label: "[Calendar]" },
      { to: "/procedures", label: "[Procedures]" },
      { to: "/reports", label: "[Reports]" }
    ];

    if (user.role === "ot_admin" || user.role === "surgeon") {
      base.push({ to: "/requests", label: "[Requests]" });
    }

    if (user.role === "ot_admin") {
      base.push({ to: "/ot-blueprint", label: "[OT Blueprint]" });
      base.push({ to: "/alerts", label: "[Alerts]" });
      base.push({ to: "/audit-logs", label: "[Audit]" });
    }

    return base;
  }, [user]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand">OR Scheduler</Link>
        {user ? (
          <>
            <p className="role-pill">
              {user.role === "ot_staff" && user.staffRole ? user.staffRole : (roleLabel[user.role] || user.role)}
            </p>
            <nav className="side-nav">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                  {item.to === "/alerts" && openAlertCount > 0 && <span className="alert-badge">{openAlertCount}</span>}
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-foot">
              <p>{user.name}</p>
              <button onClick={logout}>Logout</button>
            </div>
          </>
        ) : (
          <nav className="side-nav">
            <NavLink to="/login">[Login]</NavLink>
            <NavLink to="/register">[Register]</NavLink>
          </nav>
        )}
      </aside>
      <main className="main-pane">{children}</main>
    </div>
  );
}
