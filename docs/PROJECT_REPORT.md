# OT Scheduler - Detailed Project Report

## 1. Problem Statement
Hospital operation theater (OT) scheduling is operationally complex because room availability, doctor workload, anesthesia and nursing constraints, equipment readiness, and emergency insertions all interact. Manual or static schedules are hard to maintain when real-time changes happen (postponements, cancellations, trauma/emergency cases).

This project converts a static scheduling process into a dynamic, role-based OT workflow system that supports planning, execution, monitoring, and reporting.

## 2. Objectives
- Build a dynamic OT scheduling platform with Admin and User role flows.
- Track full surgery lifecycle from request to closure.
- Enforce scheduling constraints and resource compatibility.
- Improve visibility for live OT activity and historical analytics.
- Maintain an auditable system with persistent logs.

## 3. Scope and Modules

### 3.1 Admin Module
- Authentication and protected access.
- Manage doctors, patients, OT rooms, personnel, mobile equipment.
- Process surgeon requests and confirm OT bookings.
- Handle overlap conflicts and force scheduling workflows.
- Monitor OT activities, alerts, and audit logs.
- View analytics (utilization, SLA, turnover, material readiness).

### 3.2 User Module
- Register and login (surgeon / OT staff).
- View doctor directory and schedules.
- Submit surgery requests.
- Execute assigned operational tasks (pre-op, intra-op, post-op actions).
- Submit reports, remarks, and workflow events.

## 4. Functional Requirements Coverage

### 4.1 Scheduling and Dynamic Changes
Implemented:
- Request submission and admin processing.
- Schedule confirmations with OT/personnel selection.
- Emergency insertion and ripple-shift support.
- Postponement and conflict detection.
- Role-aware case actions.

### 4.2 Per-Procedure Information
Implemented and persisted:
- Date/time.
- OT identifier.
- Anesthesia type + anesthesiologist.
- Assistant medic (optional).
- Nurses involved.
- Pre-op/post-op tracked events/checklists.
- Reports + transcription metadata.
- Doctor remarks.
- Special drugs/instruments/materials.

### 4.3 Monitoring and Historical Views
Implemented:
- Daily operational monitor.
- Requests queue and workflow transitions.
- Procedure status/room status progression.
- Analytics endpoints for admin review.

## 5. Non-Functional Requirements

### 5.1 Modularity
- Backend split by controllers/routes/services/models/middlewares.
- Frontend split by role-aware pages/components.

### 5.2 Safety
- RBAC middleware for route-level authorization.
- Centralized error handling.
- Input validation and schedule constraints.
- Upload hardening (type + size restrictions).

### 5.3 Testability
- Node test suite with middleware and utility tests.
- Added tests for:
  - auth middleware behavior.
  - error handler behavior.
  - validation and pagination utilities.

### 5.4 Maintainability
- Clear domain files and service separation.
- Known improvement area: large files (`CalendarPage.jsx`, `procedureController.js`) should be split.

### 5.5 Portability
- Node + React + MongoDB stack.
- Environment-based configuration.
- Works on Windows/Linux/macOS with npm scripts.

## 6. System Architecture Summary
- Client: React (role-based route protection).
- API: Express + JWT auth + service layer.
- DB: MongoDB (Mongoose models).
- Realtime: Socket events for live updates.
- Logs: Winston + Morgan + audit collection.

Related design docs:
- `docs/ARCHITECTURE.md`
- `docs/LLD.md`
- `docs/WIREFRAME.md`

## 7. Low-Level Design Summary
- Domain entities: User, Doctor, Patient, Personnel, OperationTheater, Procedure, SurgeryRequest, Alert, AuditLog.
- Service responsibilities:
  - scheduling validation and conflict logic.
  - OT suggestion and compatibility scoring.
  - analytics computations.
  - alert and audit orchestration.

## 8. Security and Logging Design

### 8.1 Security
- JWT-based authentication.
- RBAC enforcement per route.
- Rate limiting and Helmet headers.
- Controlled admin registration (token-gated).

### 8.2 Logging
- HTTP access logs via Morgan -> Winston.
- Persistent app logs to server log file.
- Action-level audit logging for critical operations.
- Alert stream for operationally significant events.

## 9. Workflow
1. Surgeon submits surgery request.
2. Admin reviews and processes request.
3. System validates OT, staff, and resource constraints.
4. Admin confirms booking (or force-overrides with notifications).
5. OT staff execute case workflow and log milestones.
6. Surgeon closes case; reports become read-only.
7. Admin reviews analytics and audit trails.

## 10. Optimization Strategy

### 10.1 Code-Level
- Shared utility functions.
- Validation logic centralized in service layer.
- Reusable route-level middleware.

### 10.2 Architecture-Level
- Stateless auth allows horizontal API scaling.
- Dedicated services for scheduling and analytics.
- Realtime event-based updates reduce polling needs.

### 10.3 Data-Level
- Structured status history.
- Query filters for active/scheduled/completed slices.
- Support scripts for data repair and cleanup.

## 11. Testing Strategy and Cases
Automated tests:
- `server/src/tests/pagination.test.js`
- `server/src/tests/validate.test.js`
- `server/src/tests/auth.test.js`
- `server/src/tests/errorHandler.test.js`

Manual test matrix:
- `docs/TEST_CASES.md` (surgeon/admin/nurse/anesthesiologist + system logic).

## 12. Deployment Strategy and Justification
- Recommended:
  - Frontend: Vercel/Netlify
  - Backend: Render/Railway/VM
  - Database: MongoDB Atlas
- Local deployment supported for hospital intranet testing.
- See `README.md` for setup and script execution.

## 13. Risks and Mitigations
- Risk: scheduling conflicts during emergencies.
  - Mitigation: conflict validation + override flow + notifications.
- Risk: unauthorized access.
  - Mitigation: RBAC + JWT + rate limit.
- Risk: data inconsistency after frequent changes.
  - Mitigation: status history, audit logs, repair scripts.

## 14. Known Gaps / Future Work
- Increase integration test coverage for full request/procedure lifecycle.
- Refactor very large frontend/backend files into smaller modules.
- Add CI pipeline with lint + test + build checks.
- Add long-term retention policy and archival strategy for logs/reports.

## 15. Submission Checklist
- [x] Modular project code.
- [x] Logging integrated.
- [x] Architecture + LLD + wireframe docs.
- [x] Test cases document.
- [x] Detailed project report (this file).
- [ ] Public GitHub repository link (to be added by owner at submission).
