# System Architecture

## Components
- Web Client (React): role-based UI for Admin/User.
- API Server (Express): business logic, auth, scheduling, reporting.
- Database (MongoDB): stores master data and procedure transactions.
- File Storage (local folder now): stores uploaded surgical reports.
- Logging Layer:
  - App logs to `server.log`
  - Audit logs to MongoDB (`AuditLog` collection)

## Flow
1. User authenticates and gets JWT.
2. React sends JWT in Authorization header.
3. Express middleware validates token and role.
4. Controllers call services for scheduling constraints and analytics.
5. Models persist transactional data.
6. Actions are written to audit logs.

## Security and Safety
- Helmet for secure headers.
- CORS restriction to configured client URL.
- Rate limiting to reduce abuse.
- RBAC middleware for admin-only operations.
- Centralized error responses to avoid leaking internals.

## Scalability Considerations
- Horizontal API scaling with stateless JWT.
- Move reports from local disk to object storage (S3/Blob).
- Add queue for heavy report processing/transcription.
- Add caching for frequent schedule dashboard queries.
