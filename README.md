# Operation Scheduler (MERN)

Operation Scheduler is a MERN-stack hospital OT (Operation Theater) scheduling system.
It supports dynamic scheduling (additions, cancellation, postponement, emergency), resource tracking, pre/post-op events, reports upload, and OT monitoring dashboards.

## Tech Stack
- MongoDB, Express, React, Node.js
- Logging: Winston + Morgan + persisted audit logs in MongoDB

## Features
- Admin module:
  - Login
  - Manage doctor details
  - Manage patient details
  - Manage OT details
  - Post operation schedule details
  - Dynamic procedure status changes: planned/cancelled/postponed/emergency/completed
  - OT analytics endpoint
- User module:
  - Register
  - Login
  - View doctor details
  - View surgical information
  - Submit change request reason to admin on pending/processed requests
- OT scheduling data includes:
  - Surgery date/time
  - OT ID
  - Anesthesia type and anesthesiologist
  - Medic + assistant surgeon
  - Nurses involved
  - Pre-op and post-op tracking via timeline/checklists
  - Attached report metadata
  - Doctor remarks
  - Drugs/instruments/materials requirements

## Repository Structure
- `server/`: Express API + MongoDB models
- `client/`: React web client
- `docs/`: LLD, architecture, wireframe, and test cases

## Setup
1. Clone the repository.
2. Copy `server/.env.example` to `server/.env` and set values.
3. Install packages:
```bash
npm run install:all
```
4. Run backend:
```bash
npm run dev
```
5. Run frontend in another terminal:
```bash
npm run dev:client
```

## Seed Default Admin
Run:
```bash
npm run seed:admin -w server
```
Seed values come from `server/.env`:
- `ADMIN_SEED_EMAIL`
- `ADMIN_SEED_PASSWORD`

## Seed Demo Dataset
Run:
```bash
npm run seed:demo -w server
```
This seeds:
- admin user
- sample doctors, patients, OTs (with inventory)
- sample elective and emergency procedures for the next day

## Basic Workflow
1. Register/login as surgeon or OT staff.
2. Create OT admin using seed (`npm run seed:admin -w server`) or set `ADMIN_REGISTRATION_TOKEN` for controlled admin registration.
3. Admin adds doctors, patients, and operation theaters.
4. Surgeon submits request; admin processes and confirms schedule with OT/time/personnel assignments.
5. Admin and staff update schedule status when events occur (cancel, postpone, emergency).
6. Staff tracks timeline events and remarks; upload report files to procedures.
7. Roles view schedules and doctor directory.
8. Admin checks OT analytics for utilization and efficiency indicators.

## API Highlights
- Auth:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
- Admin:
  - `POST /api/admin/doctors`
  - `POST /api/admin/patients`
  - `POST /api/admin/ots`
  - `GET /api/admin/audit-logs`
- Procedures:
  - `POST /api/procedures`
  - `PATCH /api/procedures/:id/status`
  - `PATCH /api/procedures/:id/suspend`
  - `PATCH /api/procedures/:id/documentation`
  - `PATCH /api/procedures/:id/remarks`
- Reports and analytics:
  - `POST /api/reports/procedures/:id/report`
  - `GET /api/reports/analytics/ot`

## Logging
- HTTP request logs through Morgan into Winston.
- Action audit logs for critical operations (`AuditLog` model).
- Persistent file logs in `server.log`.

## Testing
Run server unit tests:
```bash
npm run test -w server
```
Current tests cover:
- auth middleware (token/role validation)
- error handler behavior
- input validation middleware
- pagination utility

## Troubleshooting
- `connect ECONNREFUSED 127.0.0.1:27017` means MongoDB is not running locally.
- Install MongoDB Community Server on Windows, start the `MongoDB` service, then run backend again.
- Or use MongoDB Atlas and set `MONGO_URI` in `server/.env` to your Atlas connection string.
- `npm audit` warnings are not startup errors; they can be reviewed separately with `npm audit`.

## Deployment
Recommended architecture:
- Frontend: Vercel/Netlify
- Backend: Render/Railway/EC2
- Database: MongoDB Atlas

A local deployment is also supported for hospital intranet use.

## Coding Standards
- Modular code organization by domain
- Centralized error handling
- Role-based access control middleware
- Reusable utility and service layers

## Security Notes
- OT admin self-registration is disabled by default.
- To allow controlled OT admin registration, set `ADMIN_REGISTRATION_TOKEN` in `server/.env` and pass it from a trusted setup flow.
- Report uploads are restricted to `pdf/txt/doc/docx` and max 10MB.

## Submission Notes
- Keep repository public on GitHub.
- Include this README, architecture docs, LLD, wireframe, test case document, and detailed report (`docs/PROJECT_REPORT.md`) in final submission.
- Add screenshots and demo video links in final report if required by your institution.
