import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Doctor from "../models/Doctor.js";
import Personnel from "../models/Personnel.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logAction } from "../services/auditService.js";

function toProfileId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return null;
}

function signToken(user, staffRole = null) {
  return jwt.sign({
    id: user._id,
    email: user.email,
    role: user.role,
    staffRole: staffRole || null,
    doctorProfile: toProfileId(user.doctorProfile),
    personnelProfile: toProfileId(user.personnelProfile)
  }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });
}

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, doctorProfile, personnelProfile, staffRole, adminRegistrationToken } = req.body;
  if (role === "ot_admin" && (!env.adminRegistrationToken || adminRegistrationToken !== env.adminRegistrationToken)) {
    throw new ApiError(403, "Admin self-registration is disabled. Use seed script or admin registration token.");
  }
  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, "Email already exists");

  let resolvedDoctorProfile = doctorProfile || null;
  let resolvedPersonnelProfile = personnelProfile || null;

  if (role === "surgeon" && !resolvedDoctorProfile) {
    const seed = `${Date.now()}`.slice(-5);
    const doc = await Doctor.create({
      doctorCode: `DOC-AUTO-${seed}`,
      name,
      specialization: "General Surgery",
      maxHoursPerWeek: 48,
      active: true
    });
    resolvedDoctorProfile = doc._id;
  }

  if (role === "ot_staff" && !resolvedPersonnelProfile) {
    const seed = `${Date.now()}`.slice(-5);
    const resolvedStaffRole = ["Anesthesiologist", "Nurse", "Technician"].includes(staffRole)
      ? staffRole
      : "Nurse";
    const staff = await Personnel.create({
      staffCode: `STF-AUTO-${seed}`,
      name,
      role: resolvedStaffRole,
      shiftStart: "08:00",
      shiftEnd: "18:00",
      active: true
    });
    resolvedPersonnelProfile = staff._id;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    password: hash,
    role: role || "ot_staff",
    doctorProfile: resolvedDoctorProfile,
    personnelProfile: resolvedPersonnelProfile
  });
  await logAction({
    actorId: user._id,
    actorRole: user.role,
    action: "REGISTER",
    entityType: "User",
    entityId: String(user._id)
  });

  const staffProfile = resolvedPersonnelProfile
    ? await Personnel.findById(resolvedPersonnelProfile).select("role")
    : null;

  res.status(201).json({
    token: signToken(user, staffProfile?.role || null),
    user: {
      id: user._id,
      name,
      email,
      role: user.role,
      staffRole: staffProfile?.role || null,
      doctorProfile: user.doctorProfile || null,
      personnelProfile: user.personnelProfile || null
    }
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).populate("personnelProfile", "role");
  if (!user) throw new ApiError(401, "Invalid credentials");

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw new ApiError(401, "Invalid credentials");

  await logAction({
    actorId: user._id,
    actorRole: user.role,
    action: "LOGIN",
    entityType: "User",
    entityId: String(user._id)
  });

  res.json({
    token: signToken(user, user.personnelProfile?.role || null),
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      staffRole: user.personnelProfile?.role || null,
      doctorProfile: user.doctorProfile || null,
      personnelProfile: user.personnelProfile?._id || user.personnelProfile || null
    }
  });
});
