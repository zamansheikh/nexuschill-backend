import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AdminRefreshTokenDocument = HydratedDocument<AdminRefreshToken>;

@Schema({ timestamps: true })
export class AdminRefreshToken {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  adminId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  tokenHash!: string;

  // Indexed below as a TTL (`expireAfterSeconds: 0`) so Mongo auto-purges
  // expired tokens. Don't add `index: true` here or Mongoose warns about
  // a duplicate declaration.
  @Prop({ type: Date, required: true })
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

export const AdminRefreshTokenSchema = SchemaFactory.createForClass(AdminRefreshToken);

AdminRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AdminRefreshTokenSchema.index({ adminId: 1, revoked: 1 });
