import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

const HomePage = lazy(() => import("./pages/HomePage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.jsx"));
const CalendarPage = lazy(() => import("./pages/CalendarPage.jsx"));
const ProceduresPage = lazy(() => import("./pages/ProceduresPage.jsx"));
const ReportsPage = lazy(() => import("./pages/ReportsPage.jsx"));
const RequestsPage = lazy(() => import("./pages/RequestsPage.jsx"));
const AlertsPage = lazy(() => import("./pages/AlertsPage.jsx"));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage.jsx"));
const OTBlueprintPage = lazy(() => import("./pages/OTBlueprintPage.jsx"));

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Layout>
        <Suspense fallback={<p className="muted">Loading...</p>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route
              path="/calendar"
              element={
                <ProtectedRoute roles={["ot_admin", "surgeon", "ot_staff"]}>
                  <CalendarPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/procedures"
              element={
                <ProtectedRoute roles={["ot_admin", "surgeon", "ot_staff"]}>
                  <ProceduresPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute roles={["ot_admin", "surgeon", "ot_staff"]}>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/requests"
              element={
                <ProtectedRoute roles={["ot_admin", "surgeon"]}>
                  <RequestsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/alerts"
              element={
                <ProtectedRoute roles={["ot_admin"]}>
                  <AlertsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/audit-logs"
              element={
                <ProtectedRoute roles={["ot_admin"]}>
                  <AuditLogsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/ot-blueprint"
              element={
                <ProtectedRoute roles={["ot_admin"]}>
                  <OTBlueprintPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
