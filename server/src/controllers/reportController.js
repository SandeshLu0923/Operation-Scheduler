import Procedure from "../models/Procedure.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { logAction } from "../services/auditService.js";
import { getEfficiencyHeatmap, getOtAnalytics, getResourceCalendar } from "../services/schedulerService.js";

export const uploadProcedureReport = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Report file is required");

  const procedure = await Procedure.findById(req.params.id);
  if (!procedure) throw new ApiError(404, "Procedure not found");

  procedure.reports.push({
    fileName: req.file.originalname,
    filePath: req.file.path
  });
  await procedure.save();

  await logAction({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "UPLOAD_REPORT",
    entityType: "Procedure",
    entityId: String(procedure._id),
    metadata: { fileName: req.file.originalname }
  });

  res.status(201).json(procedure.reports[procedure.reports.length - 1]);
});

export const otAnalytics = asyncHandler(async (req, res) => {
  const data = await getOtAnalytics({ startDate: req.query.startDate, endDate: req.query.endDate });
  res.json(data);
});

export const resourceCalendar = asyncHandler(async (req, res) => {
  const data = await getResourceCalendar({ date: req.query.date });
  res.json(data);
});

export const slaSummary = asyncHandler(async (req, res) => {
  const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

  const cases = await Procedure.find({
    "schedule.plannedStartTime": { $gte: startDate, $lte: endDate }
  }).select("status schedule.plannedStartTime schedule.estimatedDurationMinutes schedule.actualDurationMinutes createdAt priority");

  const total = cases.length;
  const delayed = cases.filter((c) => c.status === "Delayed").length;
  const cancelled = cases.filter((c) => c.status === "Cancelled").length;
  const emergency = cases.filter((c) => c.priority === "Emergency").length;
  const onTimeStarts = cases.filter((c) => {
    const createdAt = new Date(c.createdAt).getTime();
    const start = new Date(c.schedule.plannedStartTime).getTime();
    return start - createdAt > 60 * 60 * 1000;
  }).length;
  const avgPlanned = cases.length
    ? Number((cases.reduce((sum, c) => sum + Number(c.schedule?.estimatedDurationMinutes || 0), 0) / cases.length).toFixed(1))
    : 0;
  const avgActual = cases.length
    ? Number((cases.reduce((sum, c) => sum + Number(c.schedule?.actualDurationMinutes || 0), 0) / cases.length).toFixed(1))
    : 0;

  res.json({
    window: { startDate, endDate },
    totalCases: total,
    onTimeStartRate: total ? Number(((onTimeStarts / total) * 100).toFixed(2)) : 0,
    delayRate: total ? Number(((delayed / total) * 100).toFixed(2)) : 0,
    cancellationRate: total ? Number(((cancelled / total) * 100).toFixed(2)) : 0,
    emergencyRate: total ? Number(((emergency / total) * 100).toFixed(2)) : 0,
    avgPlannedDuration: avgPlanned,
    avgActualDuration: avgActual
  });
});

export const efficiencyHeatmap = asyncHandler(async (req, res) => {
  const data = await getEfficiencyHeatmap({ date: req.query.date });
  res.json(data);
});

export const materialReadiness = asyncHandler(async (_req, res) => {
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  const procedures = await Procedure.find({
    "schedule.plannedStartTime": { $gte: windowStart, $lte: windowEnd },
    status: { $nin: ["Cancelled"] }
  }).select("caseId procedureCode resources.materials resources.instruments resources.drugs");

  const materialsMap = new Map();
  for (const proc of procedures) {
    for (const mat of proc.resources?.materials || []) {
      const prev = materialsMap.get(mat.name) || 0;
      materialsMap.set(mat.name, prev + Number(mat.quantity || 0));
    }
  }

  res.json({
    window: { start: windowStart, end: windowEnd },
    surgeries: procedures.length,
    uniqueMaterials: Array.from(materialsMap.entries()).map(([name, quantity]) => ({ name, quantity }))
  });
});

export const turnoverGapReport = asyncHandler(async (_req, res) => {
  const procedures = await Procedure.find({ status: { $nin: ["Cancelled"] } })
    .populate("otRoomId", "otCode")
    .select("caseId otRoomId schedule.plannedStartTime schedule.plannedEndTime")
    .sort({ otRoomId: 1, "schedule.plannedStartTime": 1 });

  const byOt = new Map();
  for (const proc of procedures) {
    const otId = String(proc.otRoomId?._id || proc.otRoomId);
    if (!byOt.has(otId)) {
      byOt.set(otId, { otCode: proc.otRoomId?.otCode || "OT", entries: [] });
    }
    byOt.get(otId).entries.push(proc);
  }

  const gaps = [];
  for (const [, group] of byOt.entries()) {
    for (let i = 1; i < group.entries.length; i += 1) {
      const prev = group.entries[i - 1];
      const curr = group.entries[i];
      const gapMinutes = Math.max(
        0,
        Math.round((new Date(curr.schedule.plannedStartTime).getTime() - new Date(prev.schedule.plannedEndTime).getTime()) / 60000)
      );
      gaps.push({
        otCode: group.otCode,
        previousCaseId: prev.caseId,
        nextCaseId: curr.caseId,
        gapMinutes
      });
    }
  }

  const avgGapMinutes = gaps.length
    ? Number((gaps.reduce((sum, row) => sum + row.gapMinutes, 0) / gaps.length).toFixed(1))
    : 0;

  res.json({ avgGapMinutes, gaps });
});
