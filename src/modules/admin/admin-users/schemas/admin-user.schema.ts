import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AdminUserDocument = HydratedDocument<AdminUser>;

export enum AdminStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
  LOCKED = 'locked',
}

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class AdminUser {
  @Prop({ type: String, required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ type: String, required: true, unique: true, lowercase: true, trim: true })
  username!: string;

  @Prop({ type: String, required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, default: '' })
  displayName!: string;

  @Prop({ type: String, default: '' })
  avatarUrl!: string;

  @Prop({ type: Types.ObjectId, ref: 'AdminRole', required: true, index: true })
  roleId!: Types.ObjectId;

  /**
   * Scope restriction for agency/reseller admins.
   * When set, this admin can only see/act on data within this scope.
   *   scopeType='agency'    → scopeId references an Agency document
   *   scopeType='reseller'  → scopeId references a Reseller document
   *   both null              → global admin
   */
  @Prop({ type: String, enum: ['agency', 'reseller', null], default: null })
  scopeType?: 'agency' | 'reseller' | null;

  @Prop({ type: Types.ObjectId, default: null })
  scopeId?: Types.ObjectId | null;

  @Prop({ type: String, enum: AdminStatus, default: AdminStatus.ACTIVE })
  status!: AdminStatus;

  @Prop({ type: Number, default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil?: Date | null;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: String })
  lastLoginIp?: string;

  @Prop({ type: Boolean, default: false })
  mustChangePassword!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;

  /**
   * If this admin was created by promoting an app user, `linkedUserId` points
   * to that user's record in the `users` collection. Null for staff admins
   * who have no mobile-app identity.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  linkedUserId?: Types.ObjectId | null;
}

export const AdminUserSchema = SchemaFactory.createForClass(AdminUser);

// `email` and `username` are already indexed via `@Prop({ unique: true })` —
// re-declaring them here would trigger Mongoose duplicate-index warnings.
AdminUserSchema.index({ roleId: 1, status: 1 });
AdminUserSchema.index({ scopeType: 1, scopeId: 1 });
