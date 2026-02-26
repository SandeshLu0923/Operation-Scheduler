import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { auth } from "../middlewares/auth.js";
import { ApiError } from "../utils/ApiError.js";
import {
  efficiencyHeatmap,
  materialReadiness,
  otAnalytics,
  resourceCalendar,
  slaSummary,
  turnoverGapReport,
  uploadProcedureReport
} from "../controllers/reportController.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, "../../uploads/reports")),
  filename: (_req, file, cb) => {
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const safeName = file.originalname
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 120);
    cb(null, `${stamp}-${safeName}`);
  }
});

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new ApiError(400, "Unsupported report file type. Allowed: pdf, txt, doc, docx"));
  }
});

router.post("/procedures/:id/report", auth(["ot_admin", "surgeon", "ot_staff"]), upload.single("report"), uploadProcedureReport);
router.get("/analytics/ot", auth(["ot_admin"]), otAnalytics);
router.get("/analytics/heatmap", auth(["ot_admin"]), efficiencyHeatmap);
router.get("/analytics/material-readiness", auth(["ot_admin"]), materialReadiness);
router.get("/resources/calendar", auth(["ot_admin"]), resourceCalendar);
router.get("/sla", auth(["ot_admin"]), slaSummary);
router.get("/analytics/turnover-gap", auth(["ot_admin"]), turnoverGapReport);

export default router;
