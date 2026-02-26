# Operation Scheduler (MERN)

Operation Scheduler is a role-based OT (Operation Theater) planning and tracking platform for hospitals.  
It supports request-to-schedule flow, dynamic re-planning, intra-op milestones, PAC transfer, report uploads, and OT analytics.

## Tech Stack
- Backend: Node.js, Express, MongoDB (Mongoose), Socket.IO
- Frontend: React + Vite
- Security/ops: Helmet, CORS, rate limiting, JWT auth, Winston + Morgan logs

## Core Capabilities
- Role-based access for `ot_admin`, `surgeon`, and `ot_staff`
- Surgery request lifecycle: create, review, confirm, finalize/reject/change
- OT procedure orchestration:
  - emergency insertion
  - reschedule with reassignment options
  - setup/sign-in/time-out milestones
  - status transitions, delay tracking, turnover handling
  - arrangement acknowledgement/change requests
- Resource and readiness management:
  - OT-level inventory and mobile equipment
  - material requests/consumption logging
  - PAC status updates and room cleaning flow
- Reporting and monitoring:
  - procedure report upload
  - audit logs and alert resolution
  - OT analytics/heatmaps/material readiness/SLA/turnover gap
- Realtime notifications with Socket.IO events (procedure + alert updates)

## Repository Structure
- `server/` - Express API, models, services, scripts, tests
- `client/` - React web app (Vite)
- `docs/` - `ARCHITECTURE.md`, `LLD.md`, `TEST_CASES.md`, `WIREFRAME.md`

## Prerequisites
- Node.js 18+ (recommended)
- npm 9+
- MongoDB local or Atlas connection

## Quick Start
1. Install dependencies:
```bash
npm run install:all
```
2. Configure backend env:
```bash
Copy-Item server/.env.example server/.env
```
3. Start backend (port `5000` by default):
```bash
npm run dev
```
4. Start frontend in another terminal:
```bash
npm run dev:client
```
5. Open client at `http://localhost:5173`.

## Environment Configuration
`server/.env.example` includes:
- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `CLIENT_URL`
- `ADMIN_REGISTRATION_TOKEN`
- `ADMIN_SEED_NAME`
- `ADMIN_SEED_EMAIL`
- `ADMIN_SEED_PASSWORD`

Frontend API base URL:
- `client/src/api/client.js` uses `VITE_API_URL` (fallback: `http://localhost:5000/api`)

Realtime URL:
- `client/src/api/realtime.js` currently points to `http://localhost:5000`
- If backend URL changes, update this file accordingly

## Useful Scripts
Root:
```bash
npm run install:all
npm run dev
npm run dev:client
npm run test
```

Server:
```bash
npm run test -w server
npm run seed:admin -w server
npm run seed:demo -w server
npm run seed:test-patients -w server
npm run seed:ot-blueprint -w server
npm run diagnose:data -w server
npm run repair:invalid-refs -w server
npm run clear:operational-data -w server
```

## Seeding
Create default OT admin:
```bash
npm run seed:admin -w server
```
Uses values from `ADMIN_SEED_*` in `server/.env`.

Seed demo dataset:
```bash
npm run seed:demo -w server
```
Adds sample doctors, patients, OTs, and procedures.

## API Overview
Base path: `/api`

Health:
- `GET /health`

Auth:
- `POST /auth/register`
- `POST /auth/login`

Admin:
- doctors, patients, OTs, personnel CRUD endpoints
- `GET /admin/audit-logs`
- alerts list/resolve
- mobile equipment list/create/update

Requests:
- `GET /requests`
- `POST /requests`
- `PATCH /requests/:id/process`
- `POST /requests/:id/confirm`
- `PATCH /requests/:id/finalize`
- `PATCH /requests/:id/reject`
- `PATCH /requests/:id/request-change`

Procedures:
- list/get/create/emergency/reschedule
- checklist + surgeon readiness + timeline milestones
- status changes, delay handling, arrangement actions
- documentation/remarks/report archival

Reports & Analytics:
- `POST /reports/procedures/:id/report`
- `GET /reports/analytics/ot`
- `GET /reports/analytics/heatmap`
- `GET /reports/analytics/material-readiness`
- `GET /reports/resources/calendar`
- `GET /reports/sla`
- `GET /reports/analytics/turnover-gap`

## Realtime Events
The system emits Socket.IO events for operational updates, including:
- `procedure:created`
- `procedure:updated`
- `procedure:status`
- `alert:new`
- `alert:critical-path`

## Testing
Run backend tests:
```bash
npm run test -w server
```
Current coverage includes middleware and utility behavior (auth, validation, error handling, pagination).

## Troubleshooting
- `ECONNREFUSED 127.0.0.1:27017`: MongoDB is not reachable; start local MongoDB or use Atlas in `MONGO_URI`.
- CORS issues: confirm `CLIENT_URL` in `server/.env` matches your frontend origin.
- Login/token issues: verify `JWT_SECRET` is set and backend was restarted after env changes.

## Security Notes
- Admin self-registration is controlled via `ADMIN_REGISTRATION_TOKEN`.
- Upload endpoint accepts `pdf/txt/doc/docx` with size limits in server config.
- Rate limiting and security headers are enabled by default.
