import mongoose from "mongoose";

const doctorSchema = new mongoose.Schema(
  {
    doctorCode: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    specialization: { type: String, required: true, trim: true },
    maxHoursPerWeek: { type: Number, default: 40, min: 1 },
    preferences: {
      preferredOts: [{ type: mongoose.Schema.Types.ObjectId, ref: "OperationTheater" }],
      preferredShifts: [{ type: String }],
      materialTemplates: [
        {
          procedureType: { type: String, trim: true },
          materials: [{ name: { type: String }, quantity: { type: Number, default: 1 } }]
        }
      ]
    },
    isAssistantQualified: { type: Boolean, default: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("Doctor", doctorSchema);
