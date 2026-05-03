import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type HonorItemDocument = HydratedDocument<HonorItem>;

/// Categorical bucket the badge belongs to. Drives section grouping
/// on the mobile profile (Medal / Charm / Wealth / Special) and on
/// the admin catalog filter dropdown.
export enum HonorCategory {
  /// Generic medals — most things land here.
  MEDAL = 'medal',
  /// Charm-track achievements (received-gift values, charisma).
  CHARM = 'charm',
  /// Wealth-track achievements (sent-gift values, recharge tiers).
  WEALTH = 'wealth',
  /// Event / one-off promotional honors (anniversaries, tournaments).
  EVENT = 'event',
  /// Curated / hand-picked staff honors.
  SPECIAL = 'special',
}

/**
 * Catalog row for one honor / achievement badge.
 *
 * Honors are tiered (1..maxTier stars). The icon stays the same;
 * only the visible star count below it changes as a user upgrades.
 * In-app earning rules (sent N coins → bump tier) live outside this
 * schema — those are computed by the task system or set explicitly
 * by an admin grant.
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
export class HonorItem {
  /** Stable machine key (e.g. `charm_star`, `lv8`). Used by the task
   *  system to award without coupling to display name changes. */
  @Prop({ type: String, required: true, unique: true, trim: true, index: true })
  key!: string;

  /** Display name shown under the badge (e.g. "Charm Star"). */
  @Prop({ type: String, required: true, trim: true, maxlength: 60 })
  name!: string;

  @Prop({ type: String, default: '', maxlength: 300 })
  description!: string;

  @Prop({ type: String, enum: HonorCategory, default: HonorCategory.MEDAL, index: true })
  category!: HonorCategory;

  /** PNG / SVG of the badge artwork. Hosted on Cloudinary. */
  @Prop({ type: String, default: '' })
  iconUrl!: string;

  @Prop({ type: String, default: '' })
  iconPublicId!: string;

  /** Number of upgrade tiers this honor supports — 1..5 stars. The
   *  current tier of a user is stored on UserHonor.tier. */
  @Prop({ type: Number, default: 5, min: 1, max: 10 })
  maxTier!: number;

  /** Lower numbers come first on the mobile profile + admin list. */
  @Prop({ type: Number, default: 0 })
  sortOrder!: number;

  /** Inactive items are kept for audit but hidden from the catalog
   *  and from any user profile. */
  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;
}

export const HonorItemSchema = SchemaFactory.createForClass(HonorItem);
HonorItemSchema.index({ category: 1, sortOrder: 1 });
