# Low Level Design (LLD)

## 1. Modules
- Auth Module: registration, login, JWT issuance.
- Admin Module: CRUD for doctors, patients, operation theaters, and procedures.
- User Module: view doctors and surgical schedules.
- Procedure Lifecycle Module: status transition, remarks, timeline events, report attachments.
- Analytics Module: OT activity and efficiency summary.
- Logging Module: request logs + action audit logs.

## 2. Domain Models
- User: identity, role (`ot_admin`, `surgeon`, `ot_staff`)
- Doctor: specialization, weekly limits, OT preferences
- Patient: medical identity and diagnosis fields
- OperationTheater: OT ID, capabilities, availability window
- Procedure: schedule, participants, status, resources, reports, events
- AuditLog: actor/action/entity metadata

## 3. Key Rules
- Prevent OT booking overlap.
- Prevent doctor time overlap.
- Enforce doctor max working hours/week.
- Track every status transition in `statusHistory`.
- Persist action logs for major operations.

## 4. APIs and Responsibilities
- Controllers orchestrate request/response and role checks.
- Services hold scheduling rules and analytics aggregation.
- Models encapsulate schema constraints and indexes.
- Middleware handles auth, validation, logging, and errors.

## 5. Testability Strategy
- Unit tests for utility functions and middleware.
- Add service-level tests for schedule validation.
- Add integration tests for protected routes and transitions.

## 6. Portability
- Standard Node.js + React stack.
- Environment variables for runtime portability.
- Works on Windows/macOS/Linux with same npm scripts.
