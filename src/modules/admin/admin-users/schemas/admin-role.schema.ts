import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AdminRoleDocument = HydratedDocument<AdminRole>;

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
export class AdminRole {
  @Prop({ type: String, required: true, unique: true, lowercase: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true })
  displayName!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: [String], default: [] })
  permissions!: string[];

  /** System roles cannot be deleted and their `name` cannot be changed. */
  @Prop({ type: Boolean, default: false })
  isSystem!: boolean;

  /** Scope type this role operates within — null means global scope. */
  @Prop({ type: String, enum: ['agency', 'reseller'], default: null })
  scopeType?: 'agency' | 'reseller' | null;

  @Prop({ type: Number, default: 0 })
  priority!: number;

  @Prop({ type: Boolean, default: true })
  active!: boolean;
}

export const AdminRoleSchema = SchemaFactory.createForClass(AdminRole);
// `name` is already indexed via `@Prop({ unique: true })` above —
// declaring it again here triggers a Mongoose duplicate-index warning.
