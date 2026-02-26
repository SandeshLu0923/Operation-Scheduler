import { Router } from "express";
import {
  addDelayAndShift,
  addIntraOpMilestone,
  addRemarks,
  acknowledgeArrangement,
  archiveCombinedReport,
  completeSignIn,
  closeCase,
  createProcedure,
  emergencyInsert,
  getProcedureById,
  listProcedures,
  logMaterialConsumption,
  logDelayReason,
  markSurgeonReady,
  reassignmentOptions,
  requestMaterial,
  requestArrangementChange,
  requestTurnover,
  rescheduleProcedure,
  markRoomCleaned,
  startRoomSetup,
  surgeonTimeOut,
  transferToPacu,
  transitionProcedure,
  updateDocumentation,
  updatePreOpChecklist
} from "../controllers/procedureController.js";
import { auth } from "../middlewares/auth.js";

const router = Router();

router.get("/", auth(["ot_admin", "surgeon", "ot_staff"]), listProcedures);
router.get("/:id", auth(["ot_admin", "surgeon", "ot_staff"]), getProcedureById);
router.get("/:id/reassignment-options", auth(["ot_admin"]), reassignmentOptions);

router.post("/", auth(["ot_admin"]), createProcedure);
router.post("/emergency", auth(["ot_admin"]), emergencyInsert);
router.put("/:id/reschedule", auth(["ot_admin"]), rescheduleProcedure);
router.patch("/:id/checklist", auth(["ot_staff", "ot_admin"]), updatePreOpChecklist);
router.patch("/:id/surgeon-ready", auth(["surgeon"]), markSurgeonReady);
router.patch("/:id/status", auth(["ot_admin", "surgeon", "ot_staff"]), transitionProcedure);
router.patch("/:id/delay-reason", auth(["ot_admin", "ot_staff"]), logDelayReason);
router.patch("/:id/add-delay", auth(["ot_admin", "ot_staff"]), addDelayAndShift);
router.patch("/:id/material-consumption", auth(["ot_admin", "ot_staff"]), logMaterialConsumption);
router.patch("/:id/material-request", auth(["surgeon"]), requestMaterial);
router.patch("/:id/start-setup", auth(["ot_admin", "ot_staff"]), startRoomSetup);
router.patch("/:id/sign-in", auth(["ot_admin", "ot_staff"]), completeSignIn);
router.patch("/:id/time-out", auth(["surgeon"]), surgeonTimeOut);
router.patch("/:id/milestone", auth(["ot_admin", "ot_staff"]), addIntraOpMilestone);
router.patch("/:id/transfer-pacu", auth(["ot_admin", "ot_staff"]), transferToPacu);
router.patch("/:id/request-turnover", auth(["ot_admin", "ot_staff"]), requestTurnover);
router.patch("/:id/mark-cleaned", auth(["ot_admin", "ot_staff"]), markRoomCleaned);
router.patch("/:id/acknowledge-arrangement", auth(["surgeon"]), acknowledgeArrangement);
router.patch("/:id/request-arrangement-change", auth(["surgeon"]), requestArrangementChange);
router.patch("/:id/documentation", auth(["ot_admin", "surgeon", "ot_staff"]), updateDocumentation);
router.patch("/:id/archive-report", auth(["ot_admin"]), archiveCombinedReport);
router.patch("/:id/remarks", auth(["ot_admin", "surgeon"]), addRemarks);
router.patch("/:id/close-case", auth(["ot_admin", "surgeon"]), closeCase);

export default router;
