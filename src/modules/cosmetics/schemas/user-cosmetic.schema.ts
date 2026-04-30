import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserCosmeticDocument = HydratedDocument<UserCosmetic>;

/**
 * How a user came to own a cosmetic. Drives expiry behavior + future
 * revocation logic (e.g. when SVIP membership lapses, all SVIP-sourced
 * cosmetics get hidden but the row stays for audit).
 */
export enum CosmeticSource {
  SVIP = 'svip',
  STORE = 'store',
  GIFT = 'gift',
  EVENT = 'event',
  ADMIN_GRANT = 'admin_grant',
}

// Helper: stringify only when the value is an ObjectId. When a ref has
// been .populate()'d, it's a plain object — calling .toString() on it
// returns the literal "[object Object]", so we leave populated subdocs
// alone and let their own schema toJSON handle them.
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
      ret.userId = refToId(ret.userId);
      ret.cosmeticItemId = refToId(ret.cosmeticItemId);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class UserCosmetic {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CosmeticItem', required: true, index: true })
  cosmeticItemId!: Types.ObjectId;

  @Prop({ type: String, enum: CosmeticSource, required: true, index: true })
  source!: CosmeticSource;

  @Prop({ type: Date, default: () => new Date() })
  acquiredAt!: Date;

  /** Null = permanent. Otherwise auto-revokes on `expiresAt`. */
  @Prop({ type: Date, default: null, index: true })
  expiresAt?: Date | null;

  /** True if this is the user's currently displayed item of its type. */
  @Prop({ type: Boolean, default: false, index: true })
  equipped!: boolean;

  /** When source=gift, who sent it. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  giftedBy?: Types.ObjectId | null;

  /** When source=svip, which tier triggered the grant (1..9). */
  @Prop({ type: Number, default: null })
  svipTier?: number | null;

  /** Idempotency: same (user, item, source, externalRef) shouldn't double-grant. */
  @Prop({ type: String, default: '', index: true })
  externalRef!: string;
}

export const UserCosmeticSchema = SchemaFactory.createForClass(UserCosmetic);
UserCosmeticSchema.index({ userId: 1, cosmeticItemId: 1, source: 1, externalRef: 1 }, { unique: true });
UserCosmeticSchema.index({ expiresAt: 1 });
UserCosmeticSchema.index({ userId: 1, equipped: 1 });
