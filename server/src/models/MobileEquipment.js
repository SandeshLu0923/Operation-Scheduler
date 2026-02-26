import mongoose from "mongoose";

const mobileEquipmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("MobileEquipment", mobileEquipmentSchema);
