import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

@Schema({ timestamps: true })
export class RefreshToken {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  tokenHash!: string;

  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Boolean, default: false })
  revoked!: boolean;

  @Prop({ type: Date })
  revokedAt?: Date;

  @Prop({ type: String })
  replacedBy?: string;

  @Prop({ type: String })
  userAgent?: string;

  @Prop({ type: String })
  ipAddress?: string;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RefreshTokenSchema.index({ userId: 1, revoked: 1 });
