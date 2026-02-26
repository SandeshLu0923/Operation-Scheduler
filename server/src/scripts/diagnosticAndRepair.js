import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import User from "../models/User.js";
import Personnel from "../models/Personnel.js";
import Procedure from "../models/Procedure.js";

async function run() {
  try {
    await connectDb(env.mongoUri);

    logger.info("=== DIAGNOSTIC AND REPAIR REPORT ===");

    // 1. Check for duplicate Personnel by name and role
    logger.info("\n1. Checking for duplicate Personnel by name and role...");
    const allPersonnel = await Personnel.find();
    const nameRoleMap = new Map();

    for (const p of allPersonnel) {
      const key = `${p.name}__${p.role}`;
      if (!nameRoleMap.has(key)) {
        nameRoleMap.set(key, []);
      }
      nameRoleMap.get(key).push(p);
    }

    const duplicatePersonnelByNameRole = Array.from(nameRoleMap.entries())
      .filter(([_, arr]) => arr.length > 1)
      .map(([key, arr]) => ({
        key,
        count: arr.length,
        records: arr.map(p => ({
          id: p._id,
          staffCode: p.staffCode,
          name: p.name,
          role: p.role,
          active: p.active
        }))
      }));

    if (duplicatePersonnelByNameRole.length > 0) {
      logger.warn("Found duplicate Personnel by name+role:", JSON.stringify(duplicatePersonnelByNameRole, null, 2));
    } else {
      logger.info("✓ No duplicate Personnel by name+role found");
    }

    // 2. Check for Users linked to multiple different Personnel
    logger.info("\n2. Checking for Users linked to different Personnel...");
    const staffUsers = await User.find({ role: "ot_staff" });
    const usersByPersonnelLink = new Map();

    for (const u of staffUsers) {
      const key = u.personnelProfile?.toString() || "null";
      if (!usersByPersonnelLink.has(key)) {
        usersByPersonnelLink.set(key, []);
      }
      usersByPersonnelLink.get(key).push(u);
    }

    logger.info(`Total OT staff users: ${staffUsers.length}`);
    logger.info(`Unique Personnel links: ${usersByPersonnelLink.size}`);

    const usersByPersonnelJson = Array.from(usersByPersonnelLink.entries()).map(([pId, users]) => ({
      personnelId: pId === "null" ? null : pId,
      userCount: users.length,
      emails: users.map(u => u.email),
      staffRoles: users.map(u => u.staffRole)
    }));

    if (staffUsers.length > usersByPersonnelLink.size) {
      logger.warn("WARNING: Multiple users linked to same Personnel:", JSON.stringify(usersByPersonnelJson.filter(x => x.userCount > 1), null, 2));
    } else {
      logger.info("✓ Each OT staff user has unique Personnel link");
    }

    // 3. Check Personnel with no linked users
    logger.info("\n3. Checking Personnel with no linked users...");
    const usedPersonnelIds = new Set(staffUsers.map(u => u.personnelProfile?.toString()).filter(Boolean));
    const unutilizedPersonnel = allPersonnel.filter(p => !usedPersonnelIds.has(p._id.toString()));

    if (unutilizedPersonnel.length > 0) {
      logger.warn("Personnel not linked to any user:", unutilizedPersonnel.map(p => ({ id: p._id, name: p.name, role: p.role, staffCode: p.staffCode })));
    } else {
      logger.info("✓ All active Personnel are linked to users");
    }

    // 4. Check for procedures with invalid/orphaned team members
    logger.info("\n4. Checking procedures with invalid team references...");
    const procedures = await Procedure.find().populate("team.anesthesiologist", "_id name");
    let invalidAnesCount = 0;
    let invalidNurseCount = 0;

    for (const proc of procedures) {
      const anesId = proc.team?.anesthesiologist?._id || proc.team?.anesthesiologist;
      if (anesId && !await Personnel.findById(anesId)) {
        invalidAnesCount++;
        logger.warn(`Procedure ${proc.caseId} has invalid anesthesiologist ID: ${anesId}`);
      }

      if (proc.team?.nurses?.length > 0) {
        for (const nurseId of proc.team.nurses) {
          const nid = nurseId?._id || nurseId;
          if (nid && !await Personnel.findById(nid)) {
            invalidNurseCount++;
            logger.warn(`Procedure ${proc.caseId} has invalid nurse ID: ${nid}`);
          }
        }
      }
    }

    if (invalidAnesCount === 0 && invalidNurseCount === 0) {
      logger.info("✓ All procedure team member references are valid");
    }

    // 5. Summary
    logger.info("\n=== SUMMARY ===");
    logger.info(`Total Personnel: ${allPersonnel.length}`);
    logger.info(`Total OT Staff Users: ${staffUsers.length}`);
    logger.info(`Total Procedures: ${procedures.length}`);
    logger.info(`Issues found: ${duplicatePersonnelByNameRole.length + Math.max(0, staffUsers.length - usersByPersonnelLink.size) + unutilizedPersonnel.length + invalidAnesCount + invalidNurseCount}`);

    // REPAIR: Remove duplicate Personnel, keep one per name+role
    if (duplicatePersonnelByNameRole.length > 0) {
      logger.info("\n=== ATTEMPTING REPAIR ===");
      logger.info("Removing duplicate Personnel records...");

      for (const dup of duplicatePersonnelByNameRole) {
        const records = dup.records;
        // Keep the first active, or the first one
        const keep = records.find(r => r.active) || records[0];
        const toDelete = records.filter(r => r.id.toString() !== keep.id.toString());

        for (const del of toDelete) {
          logger.info(`Deleting duplicate Personnel: ${del.name} (${del.staffCode}) - ID: ${del.id}`);
          // Update any Users linked to this Personnel to link to the kept one
          await User.updateMany(
            { personnelProfile: del.id },
            { $set: { personnelProfile: keep.id } }
          );
          // Delete the duplicate
          await Personnel.deleteOne({ _id: del.id });
        }
      }

      logger.info("Repair completed for duplicate Personnel");
    }

  } catch (err) {
    logger.error("Diagnostic and repair failed", { error: err.message, stack: err.stack });
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
