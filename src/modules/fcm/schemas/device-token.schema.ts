import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;

export enum DevicePlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
  UNKNOWN = 'unknown',
}

/**
 * One row per (user, device) pair. We rotate tokens — Firebase issues
 * a fresh registration token whenever the app reinstalls or the user
 * clears app data — so the unique key is the token itself, not a
 * deviceId. If the same token shows up under a different user (rare,
 * happens on device transfer / multi-account), we re-attach it to
 * the new user and drop the old binding.
 *
 * Stale tokens get invalidated when FCM rejects them on send (`UNREGISTERED`
 * / `INVALID_ARGUMENT`); the FCM service deletes those rows lazily.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.userId =
        ret.userId instanceof Types.ObjectId ? ret.userId.toString() : ret.userId;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class DeviceToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** Firebase registration token. Unique across all users — Firebase
   *  guarantees this. */
  @Prop({ type: String, required: true, unique: true, index: true })
  token!: string;

  @Prop({
    type: String,
    enum: DevicePlatform,
    default: DevicePlatform.UNKNOWN,
  })
  platform!: DevicePlatform;

  /** Free-form locale tag from the device. Used for future
   *  localization of push templates. */
  @Prop({ type: String, default: '' })
  locale!: string;

  /** Refreshed each time the client re-registers (i.e. cold start
   *  while authenticated). Stale tokens (no refresh in 30+ days)
   *  are good candidates for periodic cleanup. */
  @Prop({ type: Date, default: () => new Date(), index: true })
  lastSeenAt!: Date;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);
DeviceTokenSchema.index({ userId: 1, lastSeenAt: -1 });
