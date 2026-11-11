/** @file activity-maintenance.ts @description Coalesce recovery after real Worker traffic. @module runtime */
import type { AdmissionAlarmStorage } from "../../modules/judging/admission/recovery.ts";

const repairDelay = 60_000;
const retentionInterval = 10 * repairDelay;
type Activity = { generation: number; at: number };

/** Run once after activity, then only while the database reports unfinished work. */
export class ActivityMaintenance {
  private readonly storage: AdmissionAlarmStorage;
  private readonly repair: (activity: boolean, retain: boolean) => Promise<boolean>;

  constructor(
    storage: AdmissionAlarmStorage,
    repair: (activity: boolean, retain: boolean) => Promise<boolean>,
  ) {
    this.storage = storage;
    this.repair = repair;
  }

  async request(): Promise<void> {
    await this.storage.transaction(async (tx) => {
      const prior = await tx.get<Activity>("maintenanceActivity");
      const at = Date.now();
      await tx.put("maintenanceActivity", { generation: (prior?.generation ?? 0) + 1, at });
      if ((await tx.getAlarm()) === null) await tx.setAlarm(at + repairDelay);
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
    const pending = await this.repair(activity, retain);
    await this.storage.transaction(async (tx) => {
      // A recent prearm may still be writing. Leave a trailing pass after its commit window.
      const recent = activity && started - request.at < repairDelay;
      if (activity && !recent) await tx.put("maintenanceHandled", request.generation);
      if (retain) await tx.put("lastRetention", Date.now());
      const newer =
        (await tx.get<Activity>("maintenanceActivity"))?.generation !== request.generation;
      if ((pending || recent || newer) && (await tx.getAlarm()) === null)
        await tx.setAlarm(Date.now() + repairDelay);
    });
  }
}
