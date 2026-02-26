import mongoose from "mongoose";

const personnelSchema = new mongoose.Schema(
  {
    staffCode: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["Anesthesiologist", "Nurse", "Technician"],
      required: true
    },
    phone: { type: String, trim: true, default: "" },
    shiftStart: { type: String, default: "00:00" },
    shiftEnd: { type: String, default: "23:59" },
    skills: [{ type: String, trim: true }],
    assignedOtRoom: { type: mongoose.Schema.Types.ObjectId, ref: "OperationTheater" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("Personnel", personnelSchema);
