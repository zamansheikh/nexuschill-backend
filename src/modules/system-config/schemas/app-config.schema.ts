import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppConfigDocument = HydratedDocument<AppConfig>;

/**
 * Singleton system config — only ever ONE document in this collection,
 * looked up by the canonical `_singleton` key. Stores feature toggles and
 * other admin-tunable settings that need to survive without redeploys.
 *
 * Add new flags here as they're needed; the API surface is generic so it
 * doesn't have to grow alongside.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class AppConfig {
  /** Always 'singleton' — used as the lookup key for upsert. */
  @Prop({ type: String, required: true, unique: true, default: 'singleton' })
  key!: string;

  /**
   * Whether the user-facing family feature is on. When false:
   *   - mobile clients hide the families UI
   *   - backend rejects family create / join requests
   * Existing families are preserved.
   */
  @Prop({ type: Boolean, default: true })
  familiesEnabled!: boolean;

  /**
   * Whether the agency feature is on. When false:
   *   - admin can no longer create agencies or assign hosts
   *   - mobile clients hide agency-related UI
   * Existing agencies are preserved.
   */
  @Prop({ type: Boolean, default: true })
  agenciesEnabled!: boolean;

  /**
   * Whether email + password login is exposed in the mobile app. The
   * BACKEND endpoints (`/auth/register/email`, `/auth/login/email`)
   * remain available regardless — this flag only controls UI exposure
   * so we can stage rollouts without dropping in-flight sessions.
   *
   * Default false: launch with Google / Apple Sign-In only, enable
   * email later if needed.
   */
  @Prop({ type: Boolean, default: false })
  emailLoginEnabled!: boolean;

  /**
   * Whether phone-OTP login is exposed in the mobile app. Same shape
   * as `emailLoginEnabled` — backend `/auth/otp/send` + `/auth/otp/verify`
   * stay available; this only hides the UI when off.
   *
   * Default false: lots of regions where SMS deliverability is
   * unreliable and we don't want to ship a broken-looking flow.
   */
  @Prop({ type: Boolean, default: false })
  phoneLoginEnabled!: boolean;

  /**
   * When true, only users with `isHost === true` can create audio /
   * video rooms. The path to becoming a host is the platform's
   * existing channels — admin can flip the flag on the user record,
   * or the user joins an agency (joining auto-promotes to host).
   *
   * When false, anyone can open a room (the historical default).
   *
   * Defaults to false so existing deployments don't suddenly block
   * non-host users from going live without an explicit operator
   * decision.
   */
  @Prop({ type: Boolean, default: false })
  liveRequiresAgency!: boolean;

  /**
   * When true, an audio room becomes session-scoped to its host —
   * same behaviour video rooms always have. The host walking away
   * (explicit `leave` OR heartbeat stalling past the grace window)
   * closes the room, evicts every remaining member with a
   * `ROOM_CLOSED { reason: 'host_left' }` broadcast, and frees the
   * seats.
   *
   * When false (the default), audio rooms behave as a persistent
   * "venue" — viewers stay inside even when the host steps away,
   * matching the historical behaviour. Toggle is meant for product
   * configurations where the host's voice IS the room, and an empty
   * room with no host should just close.
   */
  @Prop({ type: Boolean, default: false })
  audioHostEndsLive!: boolean;

  // ============================================================
  // Host live-record rewards (audio + video tracked separately)
  // ============================================================

  /**
   * Minimum minutes of live in a single calendar day to count as a
   * "valid day". Audio and video are tracked separately — a host
   * who streams 30 min audio + 30 min video gets neither (each
   * kind is below the threshold), but 45 min of audio alone gets
   * one audio valid day.
   *
   * Default 45 (per platform spec).
   */
  @Prop({ type: Number, default: 45, min: 1 })
  liveValidDayMinutes!: number;

  /**
   * Minimum valid days in a calendar month for the host to qualify
   * for the monthly bonus + PDF certificate. Counted as the union
   * of audio-valid and video-valid days (one valid day per
   * calendar date regardless of kind).
   *
   * Default 18 (per platform spec).
   */
  @Prop({ type: Number, default: 18, min: 1 })
  liveValidMonthDays!: number;

  /**
   * Reward credited automatically to the host's wallet at
   * Asia/Dhaka midnight for each day they cross the valid-day
   * threshold. Set to 0 to disable the daily credit while still
   * tracking valid days for the monthly accounting. Currency is
   * shared with the monthly bonus — see `liveValidRewardCurrency`.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  liveValidDayReward!: number;

  /**
   * One-shot bonus the host claims at the end of a calendar month
   * once they hit `liveValidMonthDays`. Claim is manual from the
   * mobile Live Record page; the same call generates the PDF
   * certificate. Set to 0 to disable the bonus while still
   * generating the PDF on claim.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  liveValidMonthBonus!: number;

  /**
   * Currency for both the daily reward and the monthly bonus —
   * `coins` (the platform spending currency) or `diamonds`
   * (host earning currency redeemable for withdrawals). Default
   * `coins` because that's the in-app sink most hosts care about.
   */
  @Prop({ type: String, enum: ['coins', 'diamonds'], default: 'coins' })
  liveValidRewardCurrency!: 'coins' | 'diamonds';
}

export const AppConfigSchema = SchemaFactory.createForClass(AppConfig);
// `key` is already indexed via `@Prop({ unique: true })`.
