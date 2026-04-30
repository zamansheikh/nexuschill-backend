import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Counter, CounterDocument, CounterScope } from './schemas/counter.schema';

/**
 * Allocates 7-digit public IDs (starting at 1_000_000) for users, agencies,
 * resellers, families, etc. The number is independent of the Mongo ObjectId
 * and is what users see and can search by ("ID 1234567").
 *
 * Vanity claims: when a special number is sold (e.g. 7_777_777), it gets
 * inserted into the target collection directly under that value. Because
 * `numericId` carries a unique index, sequential allocations that later
 * land on a sold number will fail with a duplicate-key error — `next()`
 * here transparently retries until it finds a free slot.
 */
const SEED = 1_000_000 - 1; // first $inc returns 1_000_000
const MAX_RETRY = 50;

@Injectable()
export class NumericIdService implements OnModuleInit {
  private readonly logger = new Logger(NumericIdService.name);

  constructor(
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
  ) {}

  async onModuleInit() {
    // Seed every counter scope so `$inc` produces 1_000_000 on the first call.
    await Promise.all(
      Object.values(CounterScope).map((scope) =>
        this.counters
          .updateOne(
            { _id: scope },
            { $setOnInsert: { _id: scope, seq: SEED } },
            { upsert: true },
          )
          .exec(),
      ),
    );
  }

  /**
   * Returns the next free numericId for the given scope. The caller is
   * responsible for using it on insert; if the insert fails due to a
   * duplicate-key on `numericId` (e.g. a vanity number was claimed in
   * parallel), call `next()` again — duplicates here are detected by the
   * caller's collection's unique index, not ours.
   */
  async next(scope: CounterScope): Promise<number> {
    const doc = await this.counters
      .findOneAndUpdate({ _id: scope }, { $inc: { seq: 1 } }, { new: true })
      .exec();
    if (!doc) {
      // onModuleInit should have created it; this is defensive.
      throw new Error(`Counter for scope "${scope}" not initialized`);
    }
    return doc.seq;
  }

  /**
   * Wraps a create-with-numericId operation with retry-on-collision logic.
   * The factory receives a candidate id, returns the inserted document or
   * throws on duplicate-key (E11000) so we can advance and try again.
   */
  async createWithId<T>(
    scope: CounterScope,
    factory: (numericId: number) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const candidate = await this.next(scope);
      try {
        return await factory(candidate);
      } catch (err: any) {
        if (err?.code === 11000 && /numericId/.test(err?.message ?? '')) {
          this.logger.warn(
            `numericId ${candidate} (${scope}) collided with vanity/existing entry — retrying`,
          );
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error(`Failed to allocate numericId for ${scope} after ${MAX_RETRY} retries`);
  }

  /**
   * Reserve a specific number for a vanity claim (or backfill). Throws
   * ConflictException if it's already taken inside the counter's monotonic
   * past. The actual collection's unique index is what enforces uniqueness;
   * this just nudges the counter past the value so future sequential
   * allocations skip it.
   */
  async claim(scope: CounterScope, value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 1_000_000 || value > 9_999_999) {
      throw new ConflictException({
        code: 'INVALID_NUMERIC_ID',
        message: 'numericId must be a 7-digit integer between 1000000 and 9999999',
      });
    }
    await this.counters
      .updateOne({ _id: scope }, { $max: { seq: value } })
      .exec();
  }
}
