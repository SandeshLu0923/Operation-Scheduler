import { Router } from "express";
import {
  getDoctorDirectory,
  getDoctorSchedule,
  getMyPreferenceCards,
  upsertMyPreferenceCard
} from "../controllers/doctorController.js";
import { auth } from "../middlewares/auth.js";

const router = Router();

router.use(auth(["ot_admin", "surgeon", "ot_staff"]));
router.get("/", getDoctorDirectory);
router.get("/me/preferences", getMyPreferenceCards);
router.post("/me/preferences", upsertMyPreferenceCard);
router.get("/:id/schedule", getDoctorSchedule);

export default router;
