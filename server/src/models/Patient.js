import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
  {
    patientCode: { type: String, required: true, unique: true, trim: true },
    mrn: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    age: { type: Number, min: 0 },
    bloodGroup: { type: String, trim: true, default: "" },
    gender: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    allergies: [{ type: String }],
    contactNumber: { type: String, trim: true },
    pacStatus: { type: String, enum: ["Incomplete", "Cleared"], default: "Incomplete" },
    pacClearedAt: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model("Patient", patientSchema);
