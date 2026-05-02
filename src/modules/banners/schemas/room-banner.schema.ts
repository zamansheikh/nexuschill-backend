import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { BannerLinkKind } from './home-banner.schema';

export type RoomBannerDocument = HydratedDocument<RoomBanner>;

/**
 * Carousel cards shown vertically in the right margin of the in-room
 * audio chat (the "Room Support / Invite Friends / Royal Night" stack).
 *
 * Mirrors HomeBanner field-for-field on purpose so admins reuse the same
 * mental model. Two extras:
 *   • `slot` (1 or 2) — which of the two stacked PageView slots the banner
 *     rotates in. The mobile carousel renders two simultaneous strips,
 *     each cycling through its own banner pool every ~5 seconds.
 *   • Linking honours BannerLinkKind so the same routing model used on
 *     the home carousel applies here too.
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
export class RoomBanner {
  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, default: '' })
  subtitle!: string;

  @Prop({ type: String, required: true })
  imageUrl!: string;

  @Prop({ type: String, default: '' })
  imagePublicId!: string;

  @Prop({ type: String, enum: BannerLinkKind, default: BannerLinkKind.NONE })
  linkKind!: BannerLinkKind;

  @Prop({ type: String, default: '' })
  linkValue!: string;

  /**
   * 1 = top stack, 2 = bottom stack. Two slots is what the in-room layout
   * supports today. Defaults to 1 so a freshly-created banner shows up
   * somewhere visible without the admin remembering to set it.
   */
  @Prop({ type: Number, default: 1, min: 1, max: 2, index: true })
  slot!: number;

  @Prop({ type: Number, default: 0, index: true })
  sortOrder!: number;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  startDate?: Date | null;

  @Prop({ type: Date, default: null })
  endDate?: Date | null;

  @Prop({ type: [String], default: [] })
  countries!: string[];

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const RoomBannerSchema = SchemaFactory.createForClass(RoomBanner);
RoomBannerSchema.index({ active: 1, slot: 1, sortOrder: -1, createdAt: -1 });
