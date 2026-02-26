import mongoose from "mongoose";

const alertSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    message: { type: String, required: true, trim: true },
    source: { type: String, default: "system" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

alertSchema.index({ resolved: 1, createdAt: -1 });

export default mongoose.model("Alert", alertSchema);
