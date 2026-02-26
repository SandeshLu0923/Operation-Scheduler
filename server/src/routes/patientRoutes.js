import { Router } from "express";
import { getPatientProcedures, getPatients, updatePacStatus } from "../controllers/patientController.js";
import { auth } from "../middlewares/auth.js";

const router = Router();

router.use(auth(["ot_admin", "surgeon", "ot_staff"]));
router.get("/", getPatients);
router.get("/:id/procedures", getPatientProcedures);
router.patch("/:id/pac", auth(["ot_admin", "ot_staff"]), updatePacStatus);

export default router;
