import mongoose from "mongoose";

const scheduleSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    plannedStartTime: { type: Date, required: true },
    plannedEndTime: { type: Date, required: true },
    bufferEndTime: { type: Date, required: true },
    estimatedDurationMinutes: { type: Number, min: 5, default: 60 },
    actualTimeIn: { type: Date },
    actualIncisionTime: { type: Date },
    actualTimeOut: { type: Date },
    actualStartTime: { type: Date },
    actualEndTime: { type: Date },
    actualDurationMinutes: { type: Number },
    estimatedFinishTime: { type: Date },
    anesthesiaReleasedAt: { type: Date },
    lateFlagSentAt: { type: Date }
  },
  { _id: false }
);

const preOpChecklistSchema = new mongoose.Schema(
  {
    patientIdentityVerified: { type: Boolean, default: false },
    consentVerified: { type: Boolean, default: false },
    surgicalSiteMarked: { type: Boolean, default: false },
    anesthesiaMachineCheck: { type: String, enum: ["Pending", "Pass", "Fail"], default: "Pending" },
    pulseOximeterFunctional: { type: Boolean, default: false },
    allergyReviewDone: { type: Boolean, default: false },
    npoStatusConfirmed: { type: Boolean, default: false },
    equipmentReadinessConfirmed: { type: Boolean, default: false },
    safetyTimeoutConfirmed: { type: Boolean, default: false },
    prosthesisCheck: { type: Boolean, default: false },
    antibioticProphylaxis: { type: Boolean, default: false },
    radiologyReady: { type: Boolean, default: false },
    bloodAvailabilityConfirmed: { type: Boolean, default: false },
    anticoagulationStatusReviewed: { type: Boolean, default: false },
    bowelPreparationVerified: { type: Boolean, default: false },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date }
  },
  { _id: false }
);

const teamSchema = new mongoose.Schema(
  {
    surgeon: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    assistantMedic: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    anesthesiologist: { type: mongoose.Schema.Types.ObjectId, ref: "Personnel", required: true },
    anesthesiaType: {
      type: String,
      enum: ["General", "Spinal", "Local", "MAC", "Regional", "Sedation"],
      required: true
    },
    nurses: [{ type: mongoose.Schema.Types.ObjectId, ref: "Personnel" }]
  },
  { _id: false }
);

const materialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, min: 1, default: 1 },
    consumed: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const resourcesSchema = new mongoose.Schema(
  {
    standardTray: { type: String, trim: true, default: "" },
    drugs: [{ type: String, trim: true }],
    instruments: [{ type: String, trim: true }],
    materials: [materialSchema],
    specialRequests: [{ type: String, trim: true }],
    specialRequirements: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const arrangementSchema = new mongoose.Schema(
  {
    gapItems: [{ type: String, trim: true }],
    alternativesApplied: [
      {
        missing: { type: String, trim: true },
        alternative: { type: String, trim: true },
        sourceType: { type: String, enum: ["mobile_pool", "other_ot_inventory", "manual"], default: "mobile_pool" },
        sourceOtId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationTheater" }
      }
    ],
    requiresSurgeonAck: { type: Boolean, default: false },
    surgeonAckStatus: {
      type: String,
      enum: ["NotRequired", "Pending", "Acknowledged", "ChangeRequested"],
      default: "NotRequired"
    },
    surgeonAckedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    surgeonAckedAt: { type: Date },
    changeRequestReason: { type: String, trim: true, default: "" },
    changeRequestedAt: { type: Date },
    reservationReleasedAt: { type: Date }
  },
  { _id: false }
);

const documentationSchema = new mongoose.Schema(
  {
    operativeReport: { type: String, default: "" },
    postOpInstructions: { type: String, default: "" },
    surgeonRemarks: { type: String, default: "" },
    liveRemarks: { type: String, default: "" },
    anesthesiaLog: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    nursingSummary: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    nurseOperativeReport: { type: String, default: "" },
    nurseRemarks: { type: String, default: "" },
    nurseReportSubmittedAt: { type: Date },
    nurseReportSubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    anesthesiologistOperativeReport: { type: String, default: "" },
    anesthesiologistRemarks: { type: String, default: "" },
    anesthesiologistReportSubmittedAt: { type: Date },
    anesthesiologistReportSubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    combinedArchiveReport: { type: String, default: "" },
    combinedArchiveAt: { type: Date },
    combinedArchiveBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    charts: [{ type: String, trim: true }],
    draftUpdatedAt: { type: Date }
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const delayLogSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      enum: ["Patient Late", "Equipment Issue", "Staff Delay", "Emergency Bump", "Other"],
      required: true
    },
    note: { type: String, default: "" },
    loggedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    loggedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: "" },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { _id: false }
);

const procedureSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, unique: true, trim: true },
    procedureCode: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    procedureType: { type: String, required: true, trim: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    otRoomId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationTheater", required: true },
    schedule: { type: scheduleSchema, required: true },
    team: { type: teamSchema, required: true },
    preOpChecklist: { type: preOpChecklistSchema, default: () => ({}) },
    resources: { type: resourcesSchema, default: () => ({}) },
    arrangement: { type: arrangementSchema, default: () => ({}) },
    documentation: { type: documentationSchema, default: () => ({}) },
    reports: [reportSchema],
    status: {
      type: String,
      enum: ["Scheduled", "Pre-Op", "In-Progress", "Recovery", "Cleaning", "Completed", "Cancelled", "Delayed", "Postponed", "Post-Op", "Pending"],
      default: "Scheduled"
    },
    roomStatus: {
      type: String,
      enum: ["Idle", "Ready", "Patient In-Room", "Live", "Recovery", "Cleaning"],
      default: "Idle"
    },
    priority: { type: String, enum: ["Elective", "Emergency"], default: "Elective" },
    surgeonReady: { type: Boolean, default: false },
    delayLogs: [delayLogSchema],
    turnoverEndsAt: { type: Date },
    caseLocked: { type: Boolean, default: false },
    caseLockedAt: { type: Date },
    caseLockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    aiRecommendation: { type: String, default: "" },
    fatigueWarning: { type: String, default: "" },
    statusHistory: [statusHistorySchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

procedureSchema.index({ otRoomId: 1, "schedule.plannedStartTime": 1, "schedule.bufferEndTime": 1 });
procedureSchema.index({ "team.surgeon": 1, "schedule.plannedStartTime": 1, "schedule.plannedEndTime": 1 });
procedureSchema.index({ "team.assistantMedic": 1, "schedule.plannedStartTime": 1, "schedule.plannedEndTime": 1 });
procedureSchema.index({ "team.anesthesiologist": 1, "schedule.plannedStartTime": 1, "schedule.plannedEndTime": 1 });
procedureSchema.index({ "team.nurses": 1, "schedule.plannedStartTime": 1, "schedule.plannedEndTime": 1 });

export default mongoose.model("Procedure", procedureSchema);
