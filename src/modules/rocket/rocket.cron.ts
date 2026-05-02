import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RocketService } from './rocket.service';

/**
 * Every 5 seconds: scan for rockets whose 10s countdown has elapsed
 * and fire the actual launch + reward distribution. The 5-second tick
 * keeps the worst-case lag (between countdown end and rewards landing)
 * under 5 seconds.
 *
 * Once daily at 00:30 Asia/Dhaka: clean up stale COUNTDOWN rows from
 * before a server crash. New gifts after midnight roll over naturally
 * via the `dayKey` upsert in addEnergy, so the daily reset is mostly
 * about housekeeping.
 */
@Injectable()
export class RocketCron {
  private readonly log = new Logger('RocketCron');

  constructor(private readonly rocket: RocketService) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick(): Promise<void> {
    try {
      const launched = await this.rocket.sweepDueLaunches();
      if (launched > 0) {
        this.log.log(`Launched ${launched} rocket(s)`);
      }
    } catch (err: any) {
      this.log.error(`Sweep failed: ${err?.message ?? err}`);
    }
  }

  /** 00:30 every day — Asia/Dhaka local time = 19:00 UTC. We use UTC
   *  for the cron expression since `@Cron` runs against the server
   *  timezone (UTC in production). This is best-effort cleanup; the
   *  real day rollover is implicit via `dayKey`. */
  @Cron('0 0 19 * * *')
  async dailyReset(): Promise<void> {
    try {
      const recovered = await this.rocket.dailyReset();
      if (recovered > 0) {
        this.log.log(`Recovered ${recovered} stale rocket(s) on daily reset`);
      }
    } catch (err: any) {
      this.log.error(`Daily reset failed: ${err?.message ?? err}`);
    }
  }
}
