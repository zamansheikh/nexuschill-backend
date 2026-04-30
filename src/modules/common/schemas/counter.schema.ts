import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

export enum CounterScope {
  USER = 'user',
  AGENCY = 'agency',
  RESELLER = 'reseller',
  FAMILY = 'family',
}

/**
 * Monotonic per-scope sequence used to mint 7-digit `numericId` values for
 * users, agencies, resellers, and families. Each scope's sequence starts at
 * 1_000_000 (the seed row stores 999_999 so the first $inc returns it).
 */
@Schema({ collection: 'counters', _id: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, required: true })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
