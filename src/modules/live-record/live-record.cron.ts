import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { LiveRecordService, dhakaParts } from './live-record.service';

/**
 * Nightly aggregator. Runs every hour to be resilient against
 * deploys / restarts that miss a single firing — the underlying
 * `aggregateDay` is idempotent (the dayModel upsert and the wallet
 * credit's idempotency key both guard against re-running for the
 * same calendar date). We target the PREVIOUS Asia/Dhaka day so a
 * cron firing at 12:30am, 1:30am, 6:30am all produce the same
 * "yesterday" rollup until we cross into the next Dhaka day.
 *
 * Why hourly: a daily-only schedule means a deploy at 12:01am
 * skips yesterday until the next day's run. Hourly cron + the
 * idempotency guards is the simplest pattern that survives
 * downtime; cost is negligible (one indexed query + one wallet
 * upsert per active host).
 */
@Injectable()
export class LiveRecordCron {
  private readonly log = new Logger('LiveRecordCron');

  constructor(private readonly svc: LiveRecordService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async aggregateYesterday(): Promise<void> {
    try {
      const now = new Date();
      const today = dhakaParts(now);
      // Compute yesterday by subtracting a full Dhaka day's worth
      // of milliseconds from "now in Dhaka" then re-parsing.
      const yesterdayUtc = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterday = dhakaParts(yesterdayUtc);
      const { rowsWritten, rewardsCredited } = await this.svc.aggregateDay({
        year: yesterday.year,
        month: yesterday.month,
        day: yesterday.day,
      });
      if (rowsWritten > 0 || rewardsCredited > 0) {
        this.log.log(
          `Aggregated ${yesterday.date} (Dhaka ${today.date}): ${rowsWritten} rows, ${rewardsCredited} rewards`,
        );
      }
    } catch (err: any) {
      this.log.error(`Live-record aggregation failed: ${err?.message ?? err}`);
    }
  }
}
