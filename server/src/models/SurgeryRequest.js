import mongoose from "mongoose";

const patientSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    age: { type: Number, min: 0, required: true },
    gender: { type: String, trim: true, required: true },
    mrn: { type: String, trim: true, required: true }
  },
  { _id: false }
);

const procedureDetailsSchema = new mongoose.Schema(
  {
    procedureName: { type: String, required: true, trim: true },
    side: { type: String, enum: ["Left", "Right", "Bilateral", "N/A"], default: "N/A" },
    estimatedDurationMinutes: { type: Number, required: true, min: 15, max: 720 },
    urgency: { type: String, enum: ["Elective", "Urgent", "Emergency"], default: "Elective" },
    anesthesiaPreference: { type: String, default: "", trim: true },
    requiredHvac: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const resourcesSchema = new mongoose.Schema(
  {
    specialEquipment: [{ type: String, trim: true }],
    specialMaterials: [{ type: String, trim: true }],
    specialDrugs: [{ type: String, trim: true }]
  },
  { _id: false }
);

const assignmentSchema = new mongoose.Schema(
  {
    otRoomId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationTheater" },
    startTime: { type: Date },
    endTime: { type: Date },
    anesthesiologist: { type: mongoose.Schema.Types.ObjectId, ref: "Personnel" },
    nurses: [{ type: mongoose.Schema.Types.ObjectId, ref: "Personnel" }],
    assistantMedic: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    anesthesiaType: { type: String, enum: ["General", "Spinal", "Local", "MAC", "Regional", "Sedation"], default: "General" },
    anesthesiaPrepTimestamp: { type: Date },
    compatibilityScore: { type: Number, default: 0 },
    gapItems: [{ type: String, trim: true }],
    mobileMovePlan: [
      {
        missing: { type: String, trim: true },
        alternative: { type: String, trim: true }
      }
    ],
    acknowledgedGap: { type: Boolean, default: false },
    acknowledgedGapBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    acknowledgedGapAt: { type: Date },
    pacStatus: { type: String, enum: ["Incomplete", "Cleared"], default: "Incomplete" },
    confirmationState: { type: String, enum: ["Tentative", "Confirmed"], default: "Tentative" },
    finalizedAt: { type: Date }
  },
  { _id: false }
);

const changeRequestSchema = new mongoose.Schema(
  {
    reason: { type: String, trim: true, default: "" },
    requestedAt: { type: Date },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" }
  },
  { _id: false }
);

const surgeryRequestSchema = new mongoose.Schema(
  {
    requestCode: { type: String, unique: true, required: true, trim: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    patient: { type: patientSnapshotSchema, required: true },
    procedure: { type: procedureDetailsSchema, required: true },
    preferredStartTime: { type: Date, required: true },
    resources: { type: resourcesSchema, default: () => ({}) },
    status: { type: String, enum: ["Pending", "Under-Review", "Scheduled", "Rejected", "Cancelled"], default: "Pending" },
    adminNotes: { type: String, default: "", trim: true },
    rejectionReason: { type: String, default: "", trim: true },
    scheduledProcedureId: { type: mongoose.Schema.Types.ObjectId, ref: "Procedure" },
    assignment: { type: assignmentSchema, default: () => ({}) },
    changeRequest: { type: changeRequestSchema, default: () => ({}) },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    confirmedAt: { type: Date }
  },
  { timestamps: true }
);

surgeryRequestSchema.index({ requestedBy: 1, status: 1, preferredStartTime: 1 });

export default mongoose.model("SurgeryRequest", surgeryRequestSchema);
