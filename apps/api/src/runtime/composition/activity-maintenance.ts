/** @file activity-maintenance.ts @description Coalesce recovery after real Worker traffic. @module runtime */
import type { AdmissionAlarmStorage } from "../../modules/judging/admission/recovery.ts";
import { currentDatabaseUsage } from "./database-usage.ts";

const repairDelay = 60_000;
const retentionInterval = 10 * repairDelay;
type Activity = { generation: number; at: number };

/** Run once after activity, then only while the database reports unfinished work. */
export class ActivityMaintenance {
  private readonly storage: AdmissionAlarmStorage;
  private readonly repair: (activity: boolean, retain: boolean) => Promise<number | null>;

  constructor(
    storage: AdmissionAlarmStorage,
    repair: (activity: boolean, retain: boolean) => Promise<number | null>,
  ) {
    this.storage = storage;
    this.repair = repair;
  }

  async request(): Promise<void> {
    await this.storage.transaction(async (tx) => {
      const prior = await tx.get<Activity>("maintenanceActivity");
      const at = Date.now();
      await tx.put("maintenanceActivity", { generation: (prior?.generation ?? 0) + 1, at });
      const next = await tx.getAlarm();
      if (next === null || next > at + repairDelay) await tx.setAlarm(at + repairDelay);
    });
  }

  async initialized(): Promise<boolean> {
    return (await this.storage.get<Activity>("maintenanceActivity")) !== undefined;
  }

  async alarm(): Promise<void> {
    const started = Date.now();
    const { request, activity, retain } = await this.storage.transaction(async (tx) => {
      const request = await tx.get<Activity>("maintenanceActivity");
      if (!request) throw new Error("Maintenance alarm not initialized");
      const activity = request.generation !== (await tx.get<number>("maintenanceHandled"));
      const lastRetention = await tx.get<number>("lastRetention");
      return {
        request,
        activity,
        retain: activity && started - (lastRetention ?? -Infinity) >= retentionInterval,
      };
    });
    const due = await this.repair(activity, retain);
    await this.storage.transaction(async (tx) => {
      // A recent prearm may still be writing. Leave a trailing pass after its commit window.
      const recent = activity && started - request.at < repairDelay;
      if (activity && !recent) await tx.put("maintenanceHandled", request.generation);
      if (retain) await tx.put("lastRetention", Date.now());
      const newer =
        (await tx.get<Activity>("maintenanceActivity"))?.generation !== request.generation;
      const now = Date.now();
      const continuation = Math.min(
        recent || newer ? now + repairDelay : Infinity,
        due === null ? Infinity : Math.max(now + repairDelay, due),
      );
      const next = await tx.getAlarm();
      if (Number.isFinite(continuation) && (next === null || continuation < next)) {
        await tx.setAlarm(continuation);
        const usage = currentDatabaseUsage();
        if (usage) {
          usage.rearm = [];
          if (due !== null) usage.rearm.push("pending-work");
          if (recent) usage.rearm.push("recent-activity");
          if (newer) usage.rearm.push("new-activity");
        }
      }
    });
  }
}
