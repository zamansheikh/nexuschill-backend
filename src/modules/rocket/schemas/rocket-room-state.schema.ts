import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RocketRoomStateDocument = HydratedDocument<RocketRoomState>;

/** One contribution log row — kept compact so the doc stays small. */
@Schema({ _id: false })
export class RocketContribution {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Cumulative energy contributed in THIS day for the active room.
   *  Reset to 0 when the daily cron rolls the day over. */
  @Prop({ type: Number, default: 0, min: 0 })
  energy!: number;
}

export const RocketContributionSchema = SchemaFactory.createForClass(
  RocketContribution,
);

/** A historical launch event — appended to `launches` when a level's
 *  energy fills. Holds enough metadata for the rewards roster page. */
@Schema({ _id: false })
export class RocketLaunchRecord {
  @Prop({ type: Number, required: true })
  level!: number;

  @Prop({ type: Date, required: true })
  launchedAt!: Date;

  /** Top-3 contributors at the moment of launch (energy snapshotted). */
  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User' },
        rank: { type: Number },
        energy: { type: Number },
        coinsAwarded: { type: Number },
      },
    ],
    default: [],
  })
  topContributors!: Array<{
    userId: Types.ObjectId;
    rank: number;
    energy: number;
    coinsAwarded: number;
  }>;

  /** Random beneficiaries from the room (excluding the top-3). */
  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User' },
        coinsAwarded: { type: Number },
      },
    ],
    default: [],
  })
  randomBeneficiaries!: Array<{
    userId: Types.ObjectId;
    coinsAwarded: number;
  }>;
}

export const RocketLaunchRecordSchema = SchemaFactory.createForClass(
  RocketLaunchRecord,
);

export enum RocketStatus {
  /** Energy filling. */
  IDLE = 'idle',
  /** Energy hit 100% — countdown to launch is in flight. */
  COUNTDOWN = 'countdown',
  /** All levels for the day have launched; no more action until reset. */
  COMPLETE = 'complete',
}

/**
 * Per-(room, day) rocket state. The (roomId, dayKey) unique index makes
 * each row the canonical "today's rocket" for one room — cron rolls the
 * day over, the next gift creates a fresh row via the upsert in
 * `addEnergy`.
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
export class RocketRoomState {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  roomId!: Types.ObjectId;

  /** yyyy-MM-dd in the configured timezone. */
  @Prop({ type: String, required: true, index: true })
  dayKey!: string;

  /** 1..maxLevel. The level currently being filled. */
  @Prop({ type: Number, default: 1, min: 1 })
  currentLevel!: number;

  /** Energy accumulated toward `currentLevel`. Resets to 0 on launch. */
  @Prop({ type: Number, default: 0, min: 0 })
  currentEnergy!: number;

  @Prop({ type: String, enum: RocketStatus, default: RocketStatus.IDLE })
  status!: RocketStatus;

  /**
   * When the countdown was started. Set when energy crosses 100%, used
   * by the cron sweeper to find rockets due for actual launch.
   */
  @Prop({ type: Date, default: null })
  countdownStartedAt?: Date | null;

  /**
   * Per-user energy contributed today — drives the top-3 ranking AND
   * the random-beneficiary picker (which draws only from active
   * contributors, not random idle viewers). Capped to ~few hundred
   * entries in practice; rooms with thousands of distinct contributors
   * per day would need pagination.
   */
  @Prop({ type: [RocketContributionSchema], default: [] })
  contributions!: RocketContribution[];

  /** History of every launch the rocket made today. */
  @Prop({ type: [RocketLaunchRecordSchema], default: [] })
  launches!: RocketLaunchRecord[];
}

export const RocketRoomStateSchema =
  SchemaFactory.createForClass(RocketRoomState);

RocketRoomStateSchema.index({ roomId: 1, dayKey: 1 }, { unique: true });
RocketRoomStateSchema.index({ status: 1, countdownStartedAt: 1 });
