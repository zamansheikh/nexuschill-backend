/**
 * Server-to-client event vocabulary for the realtime gateway. Every event
 * carries a monotonic `seq` so the client can detect gaps and request a
 * replay over the same channel.
 *
 * Two scopes:
 *   - room:<roomId>  — only members currently in the room receive these
 *   - global         — every connected user receives these (rocket banner,
 *                      maintenance banners, system pings)
 *
 * Add a new type only after the receiver knows how to render an unknown
 * type as a no-op; clients newer than the server will see types the
 * server isn't emitting yet, and vice versa.
 */
export enum RealtimeEventType {
  // ---------- Room-scoped ----------
  /** Seat ownership/lock/mute changed. Payload: full RoomSeat JSON. */
  SEAT_UPDATED = 'seat.updated',

  /** Room settings (name, announcement, micCount, theme, policies). */
  ROOM_SETTINGS_UPDATED = 'room.settings.updated',

  /** Forced room-wide event: someone was kicked/blocked. */
  ROOM_USER_BLOCKED = 'room.user.blocked',

  /** Member presence change (joined / left). */
  ROOM_MEMBER_JOINED = 'room.member.joined',
  ROOM_MEMBER_LEFT = 'room.member.left',

  /** Chat message posted in this room. Payload is the persisted message
   *  with author hydrated. */
  ROOM_CHAT_MESSAGE = 'room.chat.message',

  /** Gift sent in this room — drives the SVGA overlay + banner. */
  ROOM_GIFT_SENT = 'room.gift.sent',

  /** Host or admin invited a user to a specific seat. The payload
   *  carries the target userId; receivers filter client-side and only
   *  the target shows the accept/reject prompt. */
  SEAT_INVITED = 'seat.invited',

  /** A rocket has filled in this room and is launching now. */
  ROOM_ROCKET_LAUNCH = 'room.rocket.launch',

  // ---------- Global ----------
  /** A rocket fired somewhere on the platform — banner everyone sees. */
  GLOBAL_ROCKET_BANNER = 'global.rocket.banner',

  /** Free-form announcement banner from admin. */
  GLOBAL_ANNOUNCEMENT = 'global.announcement',
}

export interface RealtimeEvent<TPayload = unknown> {
  /** Monotonic across this scope (room or global). Set by the server. */
  seq: number;
  /** Scope this event is bound to: `room:<roomId>` or `global`. */
  scope: string;
  type: RealtimeEventType;
  payload: TPayload;
  /** ISO timestamp the server emitted at. */
  at: string;
}
