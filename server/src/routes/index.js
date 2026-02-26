import { Router } from "express";
import authRoutes from "./authRoutes.js";
import adminRoutes from "./adminRoutes.js";
import doctorRoutes from "./doctorRoutes.js";
import patientRoutes from "./patientRoutes.js";
import procedureRoutes from "./procedureRoutes.js";
import reportRoutes from "./reportRoutes.js";
import requestRoutes from "./requestRoutes.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true }));
router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);
router.use("/doctors", doctorRoutes);
router.use("/patients", patientRoutes);
router.use("/procedures", procedureRoutes);
router.use("/reports", reportRoutes);
router.use("/requests", requestRoutes);

export default router;
