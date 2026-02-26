import mongoose from "mongoose";

const operationTheaterSchema = new mongoose.Schema(
  {
    otCode: { type: String, required: true, unique: true, trim: true },
    location: { type: String, trim: true },
    roomName: { type: String, trim: true, default: "" },
    primarySpecialization: [{ type: String, trim: true }],
    fixedInfrastructure: [{ type: String, trim: true }],
    functionality: { type: String, trim: true, default: "" },
    hvacClass: { type: String, trim: true, default: "" },
    roomSize: { type: String, trim: true, default: "" },
    capabilities: [{ type: String }],
    inventory: {
      type: Map,
      of: Number,
      default: {}
    },
    maintenanceBlocks: [
      {
        startTime: { type: Date, required: true },
        endTime: { type: Date, required: true },
        reason: { type: String, default: "" },
        active: { type: Boolean, default: true }
      }
    ],
    dailyAvailableFrom: { type: String, default: "08:00" },
    dailyAvailableTo: { type: String, default: "20:00" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("OperationTheater", operationTheaterSchema);
