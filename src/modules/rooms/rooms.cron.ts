import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RoomsService } from './rooms.service';

/**
 * Every 30 seconds: scan for live video rooms whose host hasn't
 * pinged a heartbeat in the last `HOST_HEARTBEAT_GRACE_MS` window
 * and auto-close them. Mirrors how other live-streaming products
 * handle a host who silently disappears (app crash, network drop,
 * phone power-off) — viewers shouldn't be stuck in a frozen room.
 *
 * The mobile client already drives this from the other side: the
 * VideoRoomPage pings `POST /rooms/:id/heartbeat` on a 30s timer
 * for as long as the page is mounted. As soon as the page is
 * disposed (back-gesture, route push, app kill via OS), no more
 * heartbeats land — this sweeper picks up the gap within ~30s
 * of the grace window elapsing.
 */
@Injectable()
export class RoomsCron {
  private readonly log = new Logger('RoomsCron');

  constructor(private readonly rooms: RoomsService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweepStaleHostRooms(): Promise<void> {
    try {
      const closed = await this.rooms.sweepStaleHostRooms();
      if (closed > 0) {
        this.log.log(`Auto-closed ${closed} stale video room(s)`);
      }
    } catch (err: any) {
      this.log.error(`Stale-host sweep failed: ${err?.message ?? err}`);
    }
  }
}
