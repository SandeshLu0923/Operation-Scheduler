# Wireframe Notes

## Screens
1. Landing Page
- System summary
- Navigation to login/register

2. Login/Register
- Email + password auth
- Post-login redirect by role

3. Admin Console
- Panels for Doctor, Patient, OT creation
- Procedure scheduling form
- Procedure table with action buttons (postpone/cancel/emergency)

4. OT Monitor
- Date filters (past and future)
- Procedure grid with OT ID, doctor, anesthesia, status

5. Doctor Directory
- Doctor profile listing

## Navigation Map
- `/` -> Landing
- `/login` -> Login
- `/register` -> User Registration
- `/calendar` -> OT calendar + scheduling monitor (protected)
- `/procedures` -> Procedures and emergency intake (protected)
- `/reports` -> Reports and analytics views (protected)
- `/requests` -> Requests queue and approvals (protected)
- `/doctors` -> Doctor directory (protected)

## UX Notes
- Minimal layout for clarity and training usage
- Responsive grid collapses on mobile
- Tables for dense OT activity visualization
