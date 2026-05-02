import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StoreListingDocument = HydratedDocument<StoreListing>;

/**
 * The four columns shown in the screenshots. Matches CosmeticType enum
 * values for those four — the Store narrows the underlying catalog to
 * what's purchasable.
 */
export enum StoreCategory {
  FRAME = 'frame',
  VEHICLE = 'vehicle',
  THEME = 'theme',
  RING = 'ring',
}

// Stringify only ObjectId refs. Populated subdocuments are plain objects —
// calling .toString() on those produces "[object Object]" which is the
// classic JS footgun.
function refToId(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Types.ObjectId) return v.toString();
  return v;
}

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.cosmeticItemId = refToId(ret.cosmeticItemId);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class StoreListing {
  // Indexed via `StoreListingSchema.index({ cosmeticItemId: 1 })` below —
  // don't re-declare `index: true` here or Mongoose warns about a duplicate.
  @Prop({ type: Types.ObjectId, ref: 'CosmeticItem', required: true })
  cosmeticItemId!: Types.ObjectId;

  @Prop({ type: String, enum: StoreCategory, required: true, index: true })
  category!: StoreCategory;

  @Prop({ type: Number, required: true, min: 1 })
  priceCoins!: number;

  /** 0 = permanent. Otherwise the cosmetic expires N days after purchase. */
  @Prop({ type: Number, default: 7, min: 0 })
  durationDays!: number;

  @Prop({ type: Number, default: 0, index: true })
  sortOrder!: number;

  @Prop({ type: Boolean, default: false, index: true })
  featured!: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  /** Optional sale window. */
  @Prop({ type: Date, default: null })
  startDate?: Date | null;

  @Prop({ type: Date, default: null })
  endDate?: Date | null;

  @Prop({ type: Boolean, default: true })
  giftable!: boolean;
}

export const StoreListingSchema = SchemaFactory.createForClass(StoreListing);
StoreListingSchema.index({ category: 1, active: 1, featured: -1, sortOrder: -1 });
StoreListingSchema.index({ cosmeticItemId: 1 });
