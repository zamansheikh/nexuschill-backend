import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SplashBannerDocument = HydratedDocument<SplashBanner>;

/**
 * Custom splash shown to logged-in users on next app launch.
 *
 * Mobile flow:
 *   1. While the app is running, periodically fetch /splash/featured.
 *   2. Cache the resulting URL locally and warm the image disk-cache.
 *   3. On the next cold launch, the SplashPage reads the cached URL and
 *      renders that image instead of the default brand splash. The user
 *      sees an instant skinned splash; the network is unused.
 *
 * The first launch (no cache yet) always uses the default splash.
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
export class SplashBanner {
  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, required: true })
  imageUrl!: string;

  @Prop({ type: String, default: '' })
  imagePublicId!: string;

  /**
   * Higher = preferred when multiple are active simultaneously. The mobile
   * GET /splash/featured endpoint returns the single highest-priority
   * banner currently in its date window.
   */
  @Prop({ type: Number, default: 0, index: true })
  priority!: number;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  startDate?: Date | null;

  @Prop({ type: Date, default: null })
  endDate?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const SplashBannerSchema = SchemaFactory.createForClass(SplashBanner);
SplashBannerSchema.index({ active: 1, priority: -1, createdAt: -1 });
