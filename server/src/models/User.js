import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["ot_admin", "surgeon", "ot_staff"], default: "ot_staff" },
    doctorProfile: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    personnelProfile: { type: mongoose.Schema.Types.ObjectId, ref: "Personnel" }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
