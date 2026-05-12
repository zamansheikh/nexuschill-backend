import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AgencyCreateRequestDocument =
  HydratedDocument<AgencyCreateRequest>;

export enum AgencyCreateRequestStatus {
  /** User submitted the request — waiting for a platform admin to
   *  approve or reject. At most one pending request per user. */
  PENDING = 'pending',
  /** Approved by an admin. The agency was created in the same
   *  transaction, with the requester as the owner. */
  APPROVED = 'approved',
  /** Admin rejected. The user can re-apply after iterating on the
   *  proposed name / code. */
  REJECTED = 'rejected',
  /** User cancelled their own request before a decision. */
  CANCELLED = 'cancelled',
}

/**
 * User-submitted request to found a new agency. Replaces the older
 * "user holds `agency.create` power → creates instantly" flow with a
 * review queue any app user can write to. The platform admin reviews
 * the proposed name + code + description and either:
 *   • approves  → the agency is created with this user as owner,
 *   • rejects   → user can iterate and re-apply.
 *
 * The proposed fields are stored on the request so the admin can see
 * the full pitch in one place; we don't reserve the name / code until
 * approval (two users could propose the same code; the second's
 * approval will 409 and the admin can ask them to pick another).
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.userId = ret.userId?.toString();
      ret.decidedBy = ret.decidedBy?.toString();
      ret.createdAgencyId = ret.createdAgencyId?.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class AgencyCreateRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: AgencyCreateRequestStatus,
    default: AgencyCreateRequestStatus.PENDING,
    index: true,
  })
  status!: AgencyCreateRequestStatus;

  // ---- Proposed agency fields ----

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ type: String, required: true, uppercase: true, trim: true, maxlength: 20 })
  code!: string;

  @Prop({ type: String, default: '', maxlength: 500 })
  description!: string;

  @Prop({ type: String, default: 'BD', uppercase: true })
  country!: string;

  @Prop({ type: String, default: '' })
  contactEmail!: string;

  @Prop({ type: String, default: '' })
  contactPhone!: string;

  /** Logo / avatar to use for the agency. Surfaces on the admin's
   *  review page so they can see the proposed branding before
   *  approval. Stored as a URL — typically the response from the
   *  same media upload endpoint the user profile avatar uses. */
  @Prop({ type: String, default: '' })
  logoUrl!: string;

  /** Free-form pitch the user writes — surfaces to the admin alongside
   *  the proposed agency fields. Optional. */
  @Prop({ type: String, default: '', maxlength: 1000 })
  pitch!: string;

  // ---- Applicant personal info (for KYC-ish admin review) ----
  //
  // Surfaced ONLY to the platform admin during review; never echoed
  // back on the public agency record. The user is shown a note on the
  // form that this info is "only used for platform review".

  @Prop({ type: String, default: '', maxlength: 40 })
  applicantPhone!: string;

  @Prop({ type: String, default: '', maxlength: 500 })
  applicantAddress!: string;

  /** Optional photo of the applicant's government ID — front side. */
  @Prop({ type: String, default: '' })
  idCardFrontUrl!: string;

  /** Optional photo of the applicant's government ID — back side. */
  @Prop({ type: String, default: '' })
  idCardBackUrl!: string;

  // ---- Decision audit ----

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  decidedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  decidedAt?: Date | null;

  @Prop({ type: String, default: '', maxlength: 500 })
  decisionNote!: string;

  /** Filled when `status === APPROVED` — points to the agency that was
   *  created from this request. Lets the admin panel link out, and gives
   *  the mobile app something to show on the user's "your request was
   *  approved" notification. */
  @Prop({ type: Types.ObjectId, ref: 'Agency', default: null })
  createdAgencyId?: Types.ObjectId | null;
}

export const AgencyCreateRequestSchema = SchemaFactory.createForClass(
  AgencyCreateRequest,
);
// At most one pending request per user — service guards against
// duplicate submissions. Finalized requests stay around for audit.
AgencyCreateRequestSchema.index(
  { userId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: AgencyCreateRequestStatus.PENDING },
  },
);
AgencyCreateRequestSchema.index({ status: 1, createdAt: -1 });
