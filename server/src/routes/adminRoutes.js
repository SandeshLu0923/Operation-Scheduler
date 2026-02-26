import { Router } from "express";
import {
  createDoctor,
  createOt,
  createPersonnel,
  createPatient,
  addOtMaintenanceBlock,
  listAuditLogs,
  listAlerts,
  listDoctors,
  listOts,
  getOtSchedule,
  updateOt,
  listPersonnel,
  resolveAlert,
  listPatients,
  updatePersonnel,
  updateDoctor,
  updatePatient,
  listMobileEquipment,
  upsertMobileEquipment,
  updateMobileEquipment,
  applyGeneralInventoryToAllOts
} from "../controllers/adminController.js";
import { auth } from "../middlewares/auth.js";

const router = Router();

router.use(auth(["ot_admin"]));

router.post("/doctors", createDoctor);
router.get("/doctors", listDoctors);
router.patch("/doctors/:id", updateDoctor);

router.post("/patients", createPatient);
router.get("/patients", listPatients);
router.patch("/patients/:id", updatePatient);

router.post("/ots", createOt);
router.get("/ots", listOts);
router.get("/ots/:id/schedule", getOtSchedule);
router.patch("/ots/:id", updateOt);
router.post("/ots/:id/maintenance", addOtMaintenanceBlock);
router.post("/ots/apply-general-inventory", applyGeneralInventoryToAllOts);

router.post("/personnel", createPersonnel);
router.get("/personnel", listPersonnel);
router.patch("/personnel/:id", updatePersonnel);

router.get("/audit-logs", listAuditLogs);
router.get("/alerts", listAlerts);
router.patch("/alerts/:id/resolve", resolveAlert);

router.get("/mobile-equipment", listMobileEquipment);
router.post("/mobile-equipment", upsertMobileEquipment);
router.patch("/mobile-equipment/:id", updateMobileEquipment);

export default router;
