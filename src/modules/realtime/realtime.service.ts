import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { RedisService } from '../../redis/redis.service';
import { RealtimeEvent, RealtimeEventType } from './realtime.types';

/**
 * Where the rest of the app reaches for "fan this event out to everyone in
 * room X" or "fan this banner to every connected user". Owns sequence
 * allocation and a short Redis-backed replay window so reconnecting clients
 * don't lose events.
 *
 * The gateway is the only thing that talks to the actual Socket.IO server;
 * it injects itself via `attachServer()` on init so the rest of the app can
 * keep depending on this service without dragging the gateway around.
 */
const TAIL_KEY = (scope: string) => `realtime:scope:${scope}:tail`;
const SEQ_KEY = (scope: string) => `realtime:scope:${scope}:seq`;
/** Keep the last 200 events. Replay window covers ~5 min for a normal room. */
const TAIL_MAX_LEN = 200;
/** TTL on the tail list — drops idle scopes from Redis automatically. */
const TAIL_TTL_SECONDS = 300;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  constructor(private readonly redis: RedisService) {}

  /** Called by the gateway when Socket.IO is ready. */
  attachServer(server: Server) {
    this.server = server;
  }

  /** Returns the Socket.IO server, or null if the gateway isn't wired yet
   *  (e.g. boot, tests). Callers should treat null as "skip the realtime
   *  side-effect" — the action that triggered it has already persisted. */
  getServer(): Server | null {
    return this.server;
  }

  // ============== Emit ==============

  /** Emit a room-scoped event. Receivers are everyone joined to
   *  `room:<roomId>`. */
  async emitToRoom<T>(
    roomId: string,
    type: RealtimeEventType,
    payload: T,
  ): Promise<RealtimeEvent<T>> {
    return this.emit(`room:${roomId}`, type, payload);
  }

  /** Emit a global event (rocket banner, system announcement). */
  async emitGlobal<T>(
    type: RealtimeEventType,
    payload: T,
  ): Promise<RealtimeEvent<T>> {
    return this.emit('global', type, payload);
  }

  /** Lower-level: emit on a free-form scope. Caller is responsible for
   *  making sure clients subscribe to the matching scope name. */
  async emit<T>(
    scope: string,
    type: RealtimeEventType,
    payload: T,
  ): Promise<RealtimeEvent<T>> {
    const seq = await this.redis.getClient().incr(SEQ_KEY(scope));
    const event: RealtimeEvent<T> = {
      seq,
      scope,
      type,
      payload,
      at: new Date().toISOString(),
    };
    const json = JSON.stringify(event);

    // Persist to the tail for replay. Cap length + refresh TTL each push.
    const r = this.redis.getClient();
    await r
      .multi()
      .lpush(TAIL_KEY(scope), json)
      .ltrim(TAIL_KEY(scope), 0, TAIL_MAX_LEN - 1)
      .expire(TAIL_KEY(scope), TAIL_TTL_SECONDS)
      .exec();

    // Fan out. If the gateway hasn't booted yet, the persisted event is
    // still recoverable via replay — but log it so we notice during dev.
    if (!this.server) {
      this.logger.warn(
        `Emit before gateway attached (scope=${scope}, type=${type}). Persisted only.`,
      );
      return event;
    }
    this.server.to(scope).emit('event', event);
    return event;
  }

  // ============== Replay ==============

  /**
   * Return any events for `scope` newer than `sinceSeq`. The list is sorted
   * oldest-first so the client can apply them in order.
   *
   * If the client's `sinceSeq` is older than what we still have in Redis
   * (the tail rolled), we return what we have plus a `truncated: true`
   * flag — the client should treat that scope as a hard refresh case (e.g.
   * fetch the room snapshot anew).
   */
  async replay(
    scope: string,
    sinceSeq: number,
  ): Promise<{ events: RealtimeEvent[]; truncated: boolean }> {
    const r = this.redis.getClient();
    // LRANGE 0 -1 returns the full list (newest-first because we LPUSH).
    const raw = await r.lrange(TAIL_KEY(scope), 0, -1);
    if (raw.length === 0) {
      return { events: [], truncated: false };
    }

    const parsed: RealtimeEvent[] = [];
    for (const s of raw) {
      try {
        parsed.push(JSON.parse(s));
      } catch {
        // Drop a corrupt entry and keep going.
      }
    }
    // Sort oldest-first.
    parsed.sort((a, b) => a.seq - b.seq);

    const oldestSeq = parsed[0]?.seq ?? 0;
    const newest = parsed.filter((e) => e.seq > sinceSeq);

    // Truncated: caller asked for events strictly older than what we still
    // have. Their state is too stale to recover via replay alone.
    const truncated = sinceSeq > 0 && sinceSeq < oldestSeq - 1;

    return { events: newest, truncated };
  }
}
