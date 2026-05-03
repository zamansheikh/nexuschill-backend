import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SvipTierDocument = HydratedDocument<SvipTier>;

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
export class SvipTier {
  /** 1..9. Unique. The whole tier is keyed off this number. */
  @Prop({ type: Number, required: true, unique: true, min: 1, max: 9, index: true })
  level!: number;

  /** Display name, e.g. "SVIP 1", "SVIP 9". */
  @Prop({ type: String, required: true })
  name!: string;

  /** Cumulative monthly points (or coin-spend equivalent) needed to reach this tier. */
  @Prop({ type: Number, required: true, min: 0 })
  monthlyPointsRequired!: number;

  /** Coin reward granted on first reaching this tier (e.g. 270_000_000 for SVIP9). */
  @Prop({ type: Number, default: 0, min: 0 })
  coinReward!: number;

  /**
   * Coins required to **buy** this tier outright via the SVIP page.
   * Zero (the default) means the tier can only be reached via the
   * monthly-points pathway — admins set this per tier in the catalog
   * to unlock direct purchase. The mobile UI reads it to decide
   * between Buy and Recharge CTAs.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  coinPrice!: number;

  /**
   * How long the directly-purchased tier lasts, in days. Defaults to
   * 30 — common "monthly SVIP" model. Set to 0 for "permanent" if a
   * tier should never lapse on a manual buy.
   */
  @Prop({ type: Number, default: 30, min: 0 })
  durationDays!: number;

  /** Hero image / dragon icon shown on the tier landing screen. */
  @Prop({ type: String, default: '' })
  iconUrl!: string;

  @Prop({ type: String, default: '' })
  iconPublicId!: string;

  /** Optional banner / background asset for the tier detail page. */
  @Prop({ type: String, default: '' })
  bannerUrl!: string;

  @Prop({ type: String, default: '' })
  bannerPublicId!: string;

  /**
   * Cosmetic items granted to the user while they hold this tier. The same
   * IDs flow through CosmeticsService.grantToUser → UserCosmetic with
   * source=svip.
   */
  @Prop({ type: [Types.ObjectId], ref: 'CosmeticItem', default: [] })
  grantedItemIds!: Types.ObjectId[];

  /** Privilege keys from privileges.catalog.ts. */
  @Prop({ type: [String], default: [] })
  privileges!: string[];

  /** Inactive tiers are kept for history but not surfaced to users. */
  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;
}

export const SvipTierSchema = SchemaFactory.createForClass(SvipTier);
// `level` is already indexed via `@Prop({ unique: true })`.
