import { Router } from "express";
import { auth } from "../middlewares/auth.js";
import {
  confirmSurgeryRequest,
  createSurgeryRequest,
  finalizeRequestAfterPac,
  getRequestSuggestions,
  listSurgeryRequests,
  markRequestUnderReview,
  requestSurgeryChange,
  rejectSurgeryRequest
} from "../controllers/requestController.js";

const router = Router();

router.get("/", auth(["ot_admin", "surgeon"]), listSurgeryRequests);
router.get("/:id/suggestions", auth(["ot_admin"]), getRequestSuggestions);
router.post("/", auth(["surgeon"]), createSurgeryRequest);
router.patch("/:id/process", auth(["ot_admin"]), markRequestUnderReview);
router.patch("/:id/request-change", auth(["surgeon"]), requestSurgeryChange);
router.post("/:id/confirm", auth(["ot_admin"]), confirmSurgeryRequest);
router.patch("/:id/finalize", auth(["ot_admin"]), finalizeRequestAfterPac);
router.patch("/:id/reject", auth(["ot_admin"]), rejectSurgeryRequest);

export default router;
