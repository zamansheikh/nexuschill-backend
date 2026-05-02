import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { FamiliesService } from './families.service';

/**
 * Daily sweep that disbands families which have been at memberCount === 1
 * for ≥ 7 days. The 7-day clock is the `Family.soloSince` timestamp set by
 * `bumpMemberCount()` whenever the count drops to 1; cleared the moment
 * it climbs back above 1.
 *
 * Scheduled at 03:30 UTC — outside the highest-traffic hours for the
 * Bangladesh market (UTC+6 → ~09:30 local) but late enough that any 23:59
 * UTC quits from the prior day are also covered.
 */
@Injectable()
export class FamiliesCron {
  private readonly log = new Logger('FamiliesCron');

  constructor(private readonly families: FamiliesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async disbandStaleSolos(): Promise<void> {
    try {
      const count = await this.families.disbandStaleSolos();
      if (count > 0) {
        this.log.log(`Auto-disbanded ${count} stale solo family/families`);
      }
    } catch (err: any) {
      this.log.error(`Disband sweep failed: ${err?.message ?? err}`);
    }
  }
}
