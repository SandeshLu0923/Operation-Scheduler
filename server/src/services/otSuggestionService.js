import dayjs from "dayjs";
import OperationTheater from "../models/OperationTheater.js";
import Procedure from "../models/Procedure.js";
import MobileEquipment from "../models/MobileEquipment.js";

const DEFAULT_MOBILE_POOL = {
  "Mobile C-Arm (X-Ray)": 2,
  "Portable Ultrasound": 2,
  "Laparoscopic Tower (Mobile)": 2,
  "Harmonic Scalpel Unit": 2,
  "Electrosurgical Generator (ESU)": 3,
  "Mobile Robotic Unit #2": 1,
  "Portable Monitor Cart": 3,
  "Portable Neuro Navigation Cart": 1
};

const MOBILE_ALTERNATIVES = [
  { keys: ["c-arm", "x-ray"], alternative: "Mobile C-Arm (X-Ray)" },
  { keys: ["ultrasound"], alternative: "Portable Ultrasound" },
  { keys: ["laparoscopy", "tower"], alternative: "Laparoscopic Tower (Mobile)" },
  { keys: ["harmonic"], alternative: "Harmonic Scalpel Unit" },
  { keys: ["esu", "electrosurgical"], alternative: "Electrosurgical Generator (ESU)" },
  { keys: ["robotic", "davinci", "console"], alternative: "Mobile Robotic Unit #2" },
  { keys: ["4k", "video", "monitor", "display", "view box"], alternative: "Portable Monitor Cart" },
  { keys: ["angiography", "c-arm", "fluoroscopy"], alternative: "Mobile C-Arm (X-Ray)" },
  { keys: ["neuro", "navigation"], alternative: "Portable Neuro Navigation Cart" }
];

const DOMAIN_RULES = [
  {
    domain: "ORTHO",
    triggers: ["hip", "knee", "arthroplasty", "fracture", "joint", "orthopedic", "ortho", "spine"],
    specialties: ["joint", "bone", "fracture", "orthopedic", "spine"],
    capabilities: ["orthopedic", "trauma", "spine"],
    functionality: ["implant", "positioning", "imaging", "sterile"]
  },
  {
    domain: "CARDIAC",
    triggers: ["cardiac", "vascular", "tavi", "endovascular", "angioplasty", "valve", "aortic"],
    specialties: ["cardiac", "vascular", "interventional"],
    capabilities: ["cardiac", "vascular", "hybrid", "trauma"],
    functionality: ["angiography", "endovascular", "radiology", "open"]
  },
  {
    domain: "ROBOTIC",
    triggers: ["robotic", "laparoscopic", "prostatectomy", "urology", "gynecology", "bariatric", "minimally"],
    specialties: ["urology", "gynecology", "bariatric", "cardiothoracic", "gastro"],
    capabilities: ["robotic", "minimally", "laparoscopy"],
    functionality: ["console", "display", "4k", "booms", "robotic"]
  },
  {
    domain: "NEURO",
    triggers: ["neuro", "brain", "tumor", "dbs", "microsurgery", "spinal", "fusion"],
    specialties: ["brain", "neuro", "spinal"],
    capabilities: ["neuro", "microsurgery", "spine"],
    functionality: ["navigation", "microscope", "magnification", "cranial"]
  }
];

function norm(str) {
  return String(str || "").toLowerCase().trim();
}

const TOKEN_ALIAS = {
  prosthesis: "prosthetic",
  prostheses: "prosthetic",
  prosthetic: "prosthetic",
  xray: "x-ray",
  carm: "c-arm",
  orthopedic: "ortho",
  orthopaedic: "ortho",
  ortho: "ortho",
  cemented: "cement",
  imaging: "image",
  displays: "display",
  monitor: "display",
  monitors: "display",
  mounted: "mount",
  mounting: "mount",
  laminar: "airflow",
  airflow: "airflow",
  angiography: "c-arm",
  fluoroscopy: "c-arm",
  radiolucent: "radiology",
  neuro: "neuro",
  navigation: "navigation"
};

const STOP_WORDS = new Set(["the", "and", "for", "with", "fixed", "unit", "size", "to", "of"]);

function tokenize(value) {
  const raw = norm(value)
    .replace(/[^a-z0-9+\- ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return raw
    .map((t) => TOKEN_ALIAS[t] || t)
    .filter((t) => !STOP_WORDS.has(t));
}

function includesToken(text, token) {
  const source = tokenize(text);
  const target = tokenize(token);
  if (!target.length) return false;
  const sourceSet = new Set(source);
  const hits = target.filter((t) => sourceSet.has(t));
  const ratio = hits.length / target.length;
  return ratio >= 0.5 || hits.length >= 2;
}

function uniqueStrings(items = []) {
  return Array.from(new Set(items.map((v) => String(v || "").trim()).filter(Boolean)));
}

function asInventoryObject(inventory) {
  if (!inventory) return {};
  if (inventory instanceof Map) return Object.fromEntries(inventory.entries());
  return { ...inventory };
}

function isConsumableLike(item) {
  const t = norm(item);
  return ["cement", "prosthesis", "mesh", "suture", "implant", "drug", "medication", "kit"].some((k) => t.includes(k));
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return uniqueStrings(value);
  return uniqueStrings(String(value).split(/[;,]/).map((x) => x.trim()));
}

function extractRequiredItems(request) {
  return uniqueStrings([
    ...parseList(request?.resources?.specialEquipment),
    ...parseList(request?.resources?.specialMaterials)
  ]);
}

function findMobileAlternative(missingItem, mobilePool = {}) {
  const input = norm(missingItem);
  const direct = Object.keys(mobilePool).find((key) => norm(key) === input);
  if (direct && Number(mobilePool[direct] || 0) > 0) return direct;
  const hit = MOBILE_ALTERNATIVES.find((rule) => rule.keys.some((k) => input.includes(k)));
  return hit ? hit.alternative : null;
}

function toInfrastructureText(ot) {
  return [
    ...(ot.fixedInfrastructure || []),
    ...(ot.capabilities || []),
    ...(ot.primarySpecialization || []),
    ot.functionality || ""
  ].join(" | ");
}

function inferDemandProfile(request) {
  const procedureName = String(request?.procedure?.procedureName || "");
  const anesthesiaPreference = String(request?.procedure?.anesthesiaPreference || "");
  const reqItems = extractRequiredItems(request);
  const text = `${procedureName} ${anesthesiaPreference} ${reqItems.join(" ")}`;
  const textTokens = tokenize(text);

  const matchedRules = DOMAIN_RULES.filter((rule) =>
    rule.triggers.some((t) => textTokens.includes(TOKEN_ALIAS[t] || t))
  );

  const specialtyTokens = uniqueStrings(
    matchedRules.flatMap((r) => r.specialties).concat(tokenize(procedureName).slice(0, 4))
  );
  const capabilityTokens = uniqueStrings(matchedRules.flatMap((r) => r.capabilities));
  const functionalityTokens = uniqueStrings(
    matchedRules.flatMap((r) => r.functionality).concat(tokenize(anesthesiaPreference))
  );

  return {
    domains: matchedRules.map((r) => r.domain),
    specialtyTokens,
    capabilityTokens,
    functionalityTokens,
    requiredItems: reqItems
  };
}

function coverageScore(requiredTokens, sourceText) {
  if (!requiredTokens.length) return 1;
  const hits = requiredTokens.filter((token) => includesToken(sourceText, token)).length;
  return hits / requiredTokens.length;
}

function ratio(part, total) {
  if (!total) return 0;
  return part / total;
}

function findStockForItem(stockObj, itemName) {
  const exact = Object.keys(stockObj).find((k) => norm(k) === norm(itemName));
  if (exact) return Number(stockObj[exact] || 0);
  const fuzzy = Object.keys(stockObj).find((k) => includesToken(k, itemName) || includesToken(itemName, k));
  if (fuzzy) return Number(stockObj[fuzzy] || 0);
  return 0;
}

async function checkRoomBooked(otRoomId, startTime, endTime) {
  const existing = await Procedure.findOne({
    otRoomId,
    status: { $nin: ["Cancelled", "Completed"] },
    "schedule.plannedStartTime": { $lt: endTime },
    "schedule.bufferEndTime": { $gt: startTime }
  }).select("_id");
  return Boolean(existing);
}

export async function buildOtSuggestions({ request, overrideStartTime = null }) {
  const requestedStart = overrideStartTime ? dayjs(overrideStartTime) : dayjs(request.preferredStartTime);
  const duration = Number(request?.procedure?.estimatedDurationMinutes || 60);
  const requestedEnd = requestedStart.add(duration, "minute");
  const demand = inferDemandProfile(request);
  const requiredItems = demand.requiredItems;

  const [rooms, mobileItems] = await Promise.all([
    OperationTheater.find({ active: true }).lean(),
    MobileEquipment.find({ active: true }).select("name quantity").lean()
  ]);
  const mobilePool = mobileItems.length
    ? Object.fromEntries(mobileItems.map((item) => [item.name, Number(item.quantity || 0)]))
    : DEFAULT_MOBILE_POOL;
  const suggestions = [];

  for (const ot of rooms) {
    const infraText = toInfrastructureText(ot);
    const specialtyText = (ot.primarySpecialization || []).join(" | ");
    const capabilityText = (ot.capabilities || []).join(" | ");
    const functionalityText = `${ot.functionality || ""} | ${ot.roomName || ""} | ${(ot.fixedInfrastructure || []).join(" | ")}`;
    const otInventory = asInventoryObject(ot.inventory);
    const matched = [];
    const missingFixed = [];
    const mobileMoves = [];
    const unresolvable = [];

    let fixedCount = 0;
    let coveredCount = 0;
    let readinessPoints = 0;
    for (const item of requiredItems) {
      const isFixedMatch = includesToken(infraText, item);
      const localStock = findStockForItem(otInventory, item);
      const directMobileStock = findStockForItem(mobilePool, item);
      const altForItem = findMobileAlternative(item, mobilePool);
      const altMobileStock = Number((altForItem && findStockForItem(mobilePool, altForItem)) || 0);
      const hasStockPath = localStock > 0 || directMobileStock > 0 || altMobileStock > 0;
      const hasCoverage = isFixedMatch || hasStockPath;

      // Consumables/materials must be physically available in OT inventory or mobile pool.
      if (isConsumableLike(item) && !hasStockPath) {
        missingFixed.push(item);
        unresolvable.push(item);
        continue;
      }

      if (hasCoverage) {
        matched.push(item);
      } else {
        missingFixed.push(item);
      }
      if (isFixedMatch) fixedCount += 1;

      if (localStock > 0) {
        coveredCount += 1;
        readinessPoints += 1;
      } else if (directMobileStock > 0) {
        coveredCount += 1;
        readinessPoints += 0.7;
      } else {
        const alt = findMobileAlternative(item, mobilePool);
        if (alt && findStockForItem(mobilePool, alt) > 0) {
          mobileMoves.push({ missing: item, alternative: alt });
          coveredCount += 1;
          readinessPoints += 0.5;
        } else if (!isFixedMatch) {
          unresolvable.push(item);
        }
      }
    }

    const specialtyFit = coverageScore(demand.specialtyTokens, `${specialtyText} | ${capabilityText} | ${functionalityText}`);
    const capabilityFit = coverageScore(demand.capabilityTokens, `${capabilityText} | ${functionalityText}`);
    const functionalityFit = coverageScore(demand.functionalityTokens, functionalityText);
    // "Coverage" is what matters operationally: fixed OR available via inventory/mobile path.
    const fixedFit = requiredItems.length ? coveredCount / requiredItems.length : 1;
    const readinessFit = requiredItems.length ? readinessPoints / requiredItems.length : 1;

    const booked = await checkRoomBooked(ot._id, requestedStart.toDate(), requestedEnd.add(30, "minute").toDate());
    const weightedScore =
      specialtyFit * 30 +
      capabilityFit * 20 +
      functionalityFit * 15 +
      fixedFit * 20 +
      readinessFit * 15;

    // Use soft factors so alternatives still retain visibility for emergency fallback.
    const missingRatio = ratio(missingFixed.length, requiredItems.length || 1);
    const unresolvableRatio = ratio(unresolvable.length, requiredItems.length || 1);
    const availabilityFactor = booked ? 0.9 : 1;
    // Softer penalty for missing fixed items so fallback OTs remain meaningfully ranked.
    const missingFactor = requiredItems.length ? Math.max(0.68, 1 - missingRatio * 0.22) : 1;
    // Keep unresolvable impactful, but avoid collapsing all non-best options near zero.
    const unresolvableFactor = requiredItems.length ? Math.max(0.48, 1 - unresolvableRatio * 0.4) : 1;
    const compatibilityScore = Math.max(
      0,
      Math.round(weightedScore * availabilityFactor * missingFactor * unresolvableFactor)
    );

    suggestions.push({
      otId: ot._id,
      otCode: ot.otCode,
      roomName: ot.roomName || "",
      booked,
      compatibilityScore,
      matchedItems: matched,
      missingFixed,
      mobileMoves,
      unresolvable,
      scoreBreakdown: {
        specialtyFit: Math.round(specialtyFit * 100),
        capabilityFit: Math.round(capabilityFit * 100),
        functionalityFit: Math.round(functionalityFit * 100),
        fixedFit: Math.round(fixedFit * 100),
        readinessFit: Math.round(readinessFit * 100),
        availabilityPenaltyApplied: booked,
        missingRatio: Math.round(missingRatio * 100),
        unresolvableRatio: Math.round(unresolvableRatio * 100)
      },
      summary: booked
        ? `Room busy; next-best score ${compatibilityScore}%`
        : `Suggested ${ot.otCode} (${compatibilityScore}% match)`
    });
  }

  suggestions.sort((a, b) => {
    if (b.compatibilityScore !== a.compatibilityScore) return b.compatibilityScore - a.compatibilityScore;
    if (a.unresolvable.length !== b.unresolvable.length) return a.unresolvable.length - b.unresolvable.length;
    if (a.booked !== b.booked) return a.booked ? 1 : -1;
    return 0;
  });

  return {
    requiredItems,
    mobilePool,
    suggestions,
    best: suggestions[0] || null
  };
}

export function evaluateGapForSelection({ suggestionsBundle, selectedOtId }) {
  const best = suggestionsBundle.best;
  const selected = suggestionsBundle.suggestions.find((s) => String(s.otId) === String(selectedOtId));
  if (!selected) {
    return {
      selected: null,
      requiresAcknowledge: false,
      message: "No selected room data"
    };
  }

  const isSubOptimal = best && String(best.otId) !== String(selected.otId);
  const hasGap = selected.missingFixed.length > 0 || selected.booked;
  const hasUnresolvable = selected.unresolvable.length > 0;

  return {
    selected,
    best,
    isSubOptimal,
    hasGap,
    hasUnresolvable,
    requiresAcknowledge: isSubOptimal || hasGap,
    message: hasUnresolvable
      ? "Impossible to schedule: one or more required items unavailable"
      : isSubOptimal || hasGap
        ? "Selected room has resource gap/sub-optimal match. Admin acknowledgement required."
        : "Selected room fully compatible"
  };
}
