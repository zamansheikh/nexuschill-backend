import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProfileVisitDocument = HydratedDocument<ProfileVisit>;

/**
 * "Visitors" tab data — one row per (visitor, visited) pair, with the
 * row's `lastVisitedAt` updated on every fresh visit. Storing one
 * row per pair (not per view event) keeps the count honest as
 * "unique visitors" rather than "page loads", which is what every
 * party-app exposes as "Visitors: N".
 *
 * `lastVisitedAt` is the sort key for the visitors-list endpoint —
 * most recent visitor first. The unique compound index also makes
 * the upsert on each view a single round-trip.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.visitorId = ret.visitorId?.toString?.() ?? ret.visitorId;
      ret.visitedUserId =
        ret.visitedUserId?.toString?.() ?? ret.visitedUserId;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class ProfileVisit {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  visitorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  visitedUserId!: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date(), index: true })
  lastVisitedAt!: Date;
}

export const ProfileVisitSchema = SchemaFactory.createForClass(ProfileVisit);
ProfileVisitSchema.index(
  { visitorId: 1, visitedUserId: 1 },
  { unique: true },
);
// "Most recent visitors to me" — drives the list endpoint.
ProfileVisitSchema.index({ visitedUserId: 1, lastVisitedAt: -1 });
