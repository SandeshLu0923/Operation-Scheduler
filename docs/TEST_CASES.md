# OT Scheduler Test Playbook (Clean Version)

## 1. Environment Setup
1. Backend: `npm run dev -w server`
2. Frontend: `npm run dev -w client`
3. Seed demo data: `npm run seed:demo -w server`
4. Seed fixed test patients: `npm run seed:test-patients -w server`
5. Open app: `http://localhost:5173`

## 2. Test Users (Existing Accounts)
1. OT Admin: `admin@operation-scheduler.local` / `Admin@12345`
2. Surgeon: `surgeon1@otscheduler.local` / `Admin@12345`
3. Nurse: existing OT Staff login linked to `Personnel.role = Nurse`
4. Anesthesiologist: `anes1@otscheduler.local` / `Admin@12345`

## 3. Fixed Sample Data (Use Exactly)

### 3.1 Patients
| patientCode | mrn | name | age | bloodGroup | gender | diagnosis | allergies | contactNumber | pacStatus |
|---|---|---|---:|---|---|---|---|---|---|
| PAT-3001 | MRN-930001 | Aarav Menon | 46 | O+ | Male | Knee OA | Penicillin | 9000011111 | Incomplete |
| PAT-3002 | MRN-930002 | Nisha Rao | 62 | AB- | Female | CAD Triple Vessel | Latex | 9000022222 | Incomplete |
| PAT-3003 | MRN-930003 | Kabir Jain | 34 | B+ | Male | Acute Appendicitis | None | 9000033333 | Incomplete |

### 3.2 Procedure Template Test Values
1. Template: `Total Hip Replacement`
2. Auto-filled expected values:
- Procedure: `Total Hip Arthroplasty`
- Duration: `120 min`
- Standard tray/equipment: `C-arm`
- Required HVAC: `Laminar Flow`
- Required Room Size: `Large`

## 4. Single-Function Manual Test Checklist

### 4.1 Surgeon Functions

#### S-01 Request Entry (Template + Patient)
Steps:
1. Login as Surgeon.
2. Go to `Calendar` -> `Request Surgery`.
3. Select patient `MRN-930001`.
4. Select template `Total Hip Replacement`.
5. Submit.
Expected:
1. Duration auto-fills to 120.
2. Equipment auto-fills with C-arm.
3. Request appears in active requests.

#### S-02 Acknowledge Arrangement
Steps:
1. Open `Requests` page.
2. Open request details.
3. Click `Acknowledge`.
Expected:
1. Arrangement status becomes `Acknowledged`.
2. If PAC is cleared, case can become `Scheduled`.

#### S-03 Request Arrangement Change
Steps:
1. Open request details.
2. Click `Request Change`.
3. Enter reason.
Expected:
1. Arrangement status becomes `ChangeRequested`.
2. Admin sees change request alert.

#### S-04 Time-Out (Incision Timestamp)
Steps:
1. Open assigned case in Personal Surgical Calendar.
2. Click `Time-Out`.
Expected:
1. Exact incision timestamp is captured.
2. Case becomes `In-Progress` (or `Delayed` if late start).

#### S-05 Save Operative Note
Steps:
1. Enter operative report + remarks in transcription panel.
2. Click `Save Operative Report`.
Expected:
1. Data persists after refresh.

#### S-06 Close Case
Steps:
1. Click `Close Case`.
Expected:
1. Case is locked.
2. Further edits are blocked.

### 4.2 Admin Functions

#### A-01 Process Request
Steps:
1. Login as Admin.
2. `Calendar` -> `Pending Requests Queue` -> `Process`.
Expected:
1. OT booking form auto-filled from request.

#### A-02 Conflict Check: OT HVAC/Size
Steps:
1. In booking form, choose OT with mismatched HVAC/size.
2. Try confirm.
Expected:
1. Validation error (`409`) for OT environment mismatch.

#### A-03 Conflict Check: Personnel Overlap
Steps:
1. Pick surgeon or anesthesiologist already booked in same slot.
2. Try confirm.
Expected:
1. Validation error (`409`) for overlap.

#### A-04 PAC Incomplete -> Tentative
Steps:
1. Ensure patient PAC is `Incomplete`.
2. Confirm request.
Expected:
1. Request booking state shows `Tentative`.
2. Linked procedure status is `Pending`.

#### A-05 PAC Cleared -> Finalize
Steps:
1. After PAC is changed to `Cleared`, click `Finalize` on request.
Expected:
1. Request booking state becomes `Confirmed`.
2. Procedure becomes `Scheduled` (if surgeon-ack gate is satisfied).

#### A-06 Operations Search & Open
Steps:
1. Open admin `Calendar` -> `Operations`.
2. Search by operation ID, surgeon, or patient.
3. Click `Open Case`.
Expected:
1. Matching operation appears.
2. Case opens in workflow view with live/scheduled status context.

### 4.3 Nurse Functions

#### N-01 Start Setup
Steps:
1. Login as Nurse.
2. `Live Room Monitor` -> click `Start Setup`.
Expected:
1. Setup timestamp saved.

#### N-02 Complete Sign-In
Steps:
1. Click `Complete Sign-In`.
Expected:
1. WHO Sign-In completed.
2. Room status becomes `Patient In-Room`.

#### N-03 Incision Dependency Gate
Steps:
1. Try to start incision before Sign-In on a case.
Expected:
1. Blocked by dependency rule.

#### N-04 Intra-Op Milestone
Steps:
1. Click `Closure Started (+15m)`.
Expected:
1. Milestone saved with ETA 15 minutes.
2. Visible to admin in live updates.

#### N-05 Counts + WHO Sign-Out
Steps:
1. In Operation Log, fill sponge/needle/instrument counts.
2. Fill WHO Sign-Out fields.
3. Save Operation Log.
Expected:
1. Nursing summary persists after refresh.

#### N-06 Turnover and Cleaned
Steps:
1. Click `Request Turnover`.
2. Click `Cleaned`.
Expected:
1. Status transitions `Cleaning` -> `Completed`.
2. Room status becomes `Ready`.
3. Next-patient alert is generated.

### 4.4 Anesthesiologist Functions

#### AN-01 Update PAC Status
Steps:
1. Login as Anesthesiologist.
2. Open assigned case.
3. Click `PAC Cleared` (or `PAC Incomplete`).
Expected:
1. Patient PAC status updates immediately.

#### AN-02 Joint Sign-In
Steps:
1. Click `Complete Sign-In`.
Expected:
1. Allowed for anesthesiologist role.
2. Room status becomes `Patient In-Room`.

#### AN-03 Save Anesthesia Log
Steps:
1. Open Operation Log.
2. Add vitals row, fluid row, and drug check/time.
3. Save.
Expected:
1. Anesthesia log persists.
2. Cumulative I/O totals (In, Out, Balance) are saved.

#### AN-04 Transfer to PACU
Steps:
1. Click `Transfer to PACU`.
Expected:
1. Case status becomes `Recovery`.
2. `anesthesiaReleasedAt` is captured.
3. Scheduler can reuse this anesthesiologist for next case.

## 5. System Logic Function Tests

### L-01 Turnover Buffer
Steps:
1. Try scheduling two cases in same OT with less than 20-minute gap.
Expected:
1. Conflict/adjustment enforces turnover buffer.

### L-02 Late Flag (>10%)
Steps:
1. Use a case with estimate `100 min`.
2. Complete case with actual duration `>110 min`.
Expected:
1. `late_flag` alert generated.
2. Alert includes next queued case/surgeon context.

### L-03 PAC + Surgeon Ack Combined Gate
Steps:
1. Keep PAC incomplete OR arrangement ack pending.
Expected:
1. Procedure remains `Pending`.
2. Becomes `Scheduled` only when both are satisfied.

## 6. Minimal API Payloads (Manual Trigger)

### 6.1 Confirm Request (Admin)
```json
{
  "otRoomId": "OT_ID_A",
  "startTime": "2026-02-25T09:00:00.000Z",
  "anesthesiologist": "ANES_ID_A",
  "nurses": ["NURSE_ID_A"],
  "assistantMedic": null,
  "anesthesiaType": "General",
  "anesthesiaPrepTimestamp": "2026-02-25T08:30:00.000Z",
  "acknowledgeGap": true,
  "plannedAlternatives": []
}
```

### 6.2 PAC Update
```json
{
  "pacStatus": "Cleared"
}
```

### 6.3 Milestone Update
```json
{
  "label": "Closure Started",
  "etaMinutes": 15
}
```

### 6.4 Finalize Tentative Request
```json
{}
```

## 7. Quick Troubleshooting
1. New route returns 404: restart backend.
2. 401/403: role mismatch or expired login token; login again.
3. Start incision blocked: check Sign-In + checklist + surgeon ready.
4. Cannot finalize: PAC not cleared or surgeon arrangement ack pending.
