import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { RoomKind } from '../rooms/schemas/room.schema';
import {
  LiveSession,
  LiveSessionDocument,
} from '../rooms/schemas/live-session.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Currency, TxnType } from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  LiveDayRecord,
  LiveDayRecordDocument,
} from './schemas/live-day-record.schema';
import {
  LiveMonthRecord,
  LiveMonthRecordDocument,
} from './schemas/live-month-record.schema';

/**
 * Asia/Dhaka offset (UTC+6, no DST). The platform serves a mostly-BD
 * audience and accounts in this timezone — the same convention
 * `RoomsService.liveStatsForUser` uses. We don't rely on the OS
 * timezone DB because the runtime's IANA data isn't guaranteed and
 * we don't want production buckets to flip if the container's tz
 * changes.
 */
const DHAKA_OFFSET_MIN = 6 * 60;

/**
 * Build the Asia/Dhaka calendar parts for a given UTC instant.
 * Returns the `YYYY-MM-DD` bucket label + the integer parts so
 * callers can index by year/month/day without re-parsing.
 */
function dhakaParts(d: Date): {
  date: string;
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(d.getTime() + DHAKA_OFFSET_MIN * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date, year: y, month: m, day };
}

/** Start (inclusive) of the given Dhaka calendar day, as a UTC Date. */
function dhakaDayStartUtc(year: number, month: number, day: number): Date {
  // Midnight in Dhaka = (00:00 + 6h) UTC = 18:00 UTC the previous day.
  return new Date(Date.UTC(year, month - 1, day, -6, 0, 0, 0));
}

/** End (exclusive) of the given Dhaka calendar day. */
function dhakaDayEndUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day + 1, -6, 0, 0, 0));
}

export interface MonthlyRecordResponse {
  year: number;
  month: number;
  /** Per-day breakdown for every day of the requested month — a
   *  dense array sized to the month's length, days with no live
   *  session show zeros. */
  days: Array<{
    date: string;
    day: number;
    audioSec: number;
    videoSec: number;
    audioValid: boolean;
    videoValid: boolean;
    isValid: boolean;
    rewarded: boolean;
  }>;
  validDays: number;
  audioValidDays: number;
  videoValidDays: number;
  /** Snapshot of the admin thresholds at read time. Mobile uses
   *  these to render the "X / 18" progress without re-fetching
   *  system config. */
  validDayMinutes: number;
  validMonthDays: number;
  /** Reward amounts + currency snapshot. Same reasoning. */
  dayReward: number;
  monthBonus: number;
  currency: 'coins' | 'diamonds';
  /** Monthly bonus claim state — populated from LiveMonthRecord
   *  if a row exists, otherwise the defaults below. */
  claim: {
    eligible: boolean;
    claimed: boolean;
    claimedAt: string | null;
    bonusAmount: number | null;
    bonusCurrency: 'coins' | 'diamonds' | null;
  };
}

@Injectable()
export class LiveRecordService {
  private readonly log = new Logger('LiveRecordService');

  constructor(
    @InjectModel(LiveDayRecord.name)
    private readonly dayModel: Model<LiveDayRecordDocument>,
    @InjectModel(LiveMonthRecord.name)
    private readonly monthModel: Model<LiveMonthRecordDocument>,
    @InjectModel(LiveSession.name)
    private readonly sessionModel: Model<LiveSessionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly systemConfig: SystemConfigService,
    private readonly wallet: WalletService,
  ) {}

  // ============================================================
  // Read — fired from the mobile Live Record page
  // ============================================================

  /**
   * Compute (or read cached) per-day breakdown for the host's
   * requested calendar month. The cron writes `LiveDayRecord`
   * rows the morning after each day, but we ALSO read uncached
   * sessions for "today" so the live page is never stale — the
   * cron-vs-realtime split keeps the cheap path cheap (indexed
   * read of the existing rollup) while serving the active day
   * from sessions directly.
   */
  async getMonthly(
    userId: string,
    year: number,
    month: number,
  ): Promise<MonthlyRecordResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id',
      });
    }
    if (month < 1 || month > 12) {
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: 'Month must be 1..12',
      });
    }
    const userOid = new Types.ObjectId(userId);
    const cfg = await this.systemConfig.getConfig();
    const dayThresholdSec = cfg.liveValidDayMinutes * 60;

    // 1. Pull cached daily rollups for the month.
    const cached = await this.dayModel
      .find({ userId: userOid, year, month })
      .lean()
      .exec();
    // Narrow projection — the monthly read only needs these
    // fields, and a permissive map type lets the synthesized
    // "today" row land alongside the cached lean rows without
    // fighting Mongoose's hydrated-doc generics.
    type DayRowLite = {
      date: string;
      audioSec: number;
      videoSec: number;
      audioValid: boolean;
      videoValid: boolean;
      rewarded: boolean;
    };
    const cachedByDate = new Map<string, DayRowLite>(
      cached.map((d) => [
        d.date,
        {
          date: d.date,
          audioSec: d.audioSec,
          videoSec: d.videoSec,
          audioValid: d.audioValid,
          videoValid: d.videoValid,
          rewarded: d.rewarded,
        },
      ]),
    );

    // 2. Overlay any uncached "today" totals — the cron only writes
    //    yesterday's rollup, so the active day always needs an
    //    on-the-fly aggregation.
    const now = new Date();
    const today = dhakaParts(now);
    if (today.year === year && today.month === month) {
      const live = await this._aggregateOneDay(userOid, year, month, today.day);
      const audioValid = live.audio >= dayThresholdSec;
      const videoValid = live.video >= dayThresholdSec;
      cachedByDate.set(today.date, {
        date: today.date,
        audioSec: live.audio,
        videoSec: live.video,
        audioValid,
        videoValid,
        rewarded: cachedByDate.get(today.date)?.rewarded ?? false,
      });
    }

    // 3. Build the dense per-day array.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days = [] as MonthlyRecordResponse['days'];
    let validDays = 0;
    let audioValidDays = 0;
    let videoValidDays = 0;
    for (let d = 1; d <= lastDay; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const row = cachedByDate.get(date);
      const audioSec = row?.audioSec ?? 0;
      const videoSec = row?.videoSec ?? 0;
      const audioValid = (row?.audioValid ?? false) || audioSec >= dayThresholdSec;
      const videoValid = (row?.videoValid ?? false) || videoSec >= dayThresholdSec;
      const isValid = audioValid || videoValid;
      if (audioValid) audioValidDays += 1;
      if (videoValid) videoValidDays += 1;
      if (isValid) validDays += 1;
      days.push({
        date,
        day: d,
        audioSec,
        videoSec,
        audioValid,
        videoValid,
        isValid,
        rewarded: row?.rewarded ?? false,
      });
    }

    // 4. Look up the monthly claim ledger (lazy-create not needed
    //    here — absence means "never claimed").
    const monthly = await this.monthModel
      .findOne({ userId: userOid, year, month })
      .lean()
      .exec();
    const eligible = validDays >= cfg.liveValidMonthDays && !(monthly?.claimed ?? false);

    return {
      year,
      month,
      days,
      validDays,
      audioValidDays,
      videoValidDays,
      validDayMinutes: cfg.liveValidDayMinutes,
      validMonthDays: cfg.liveValidMonthDays,
      dayReward: cfg.liveValidDayReward,
      monthBonus: cfg.liveValidMonthBonus,
      currency: cfg.liveValidRewardCurrency,
      claim: {
        eligible,
        claimed: monthly?.claimed ?? false,
        claimedAt: monthly?.claimedAt?.toISOString() ?? null,
        bonusAmount: monthly?.bonusAmount ?? null,
        bonusCurrency: monthly?.bonusCurrency ?? null,
      },
    };
  }

  // ============================================================
  // Claim — manual monthly bonus + PDF certificate trigger
  // ============================================================

  /**
   * Credit the monthly bonus and create / update the
   * LiveMonthRecord row marking the claim. Throws when the host
   * hasn't met the threshold or already claimed. Returns the
   * record so the controller can stream the PDF immediately
   * after.
   */
  async claimMonthly(
    userId: string,
    year: number,
    month: number,
  ): Promise<LiveMonthRecordDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id',
      });
    }
    if (month < 1 || month > 12) {
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: 'Month must be 1..12',
      });
    }
    const userOid = new Types.ObjectId(userId);
    const cfg = await this.systemConfig.getConfig();

    // Block claiming the CURRENT month — the count isn't final until
    // the month closes. The mobile page already hides the button for
    // current month; this is the server-side guard.
    const today = dhakaParts(new Date());
    if (today.year === year && today.month === month) {
      throw new ForbiddenException({
        code: 'MONTH_NOT_FINAL',
        message: 'You can claim the bonus once the month ends',
      });
    }
    if (
      year > today.year ||
      (year === today.year && month > today.month)
    ) {
      throw new ForbiddenException({
        code: 'MONTH_NOT_FINAL',
        message: 'Cannot claim a future month',
      });
    }

    // Idempotency — if a claim row already exists and is claimed,
    // refuse rather than double-credit. The mobile page should
    // never offer the button in this case but the server is the
    // authority.
    const existing = await this.monthModel
      .findOne({ userId: userOid, year, month })
      .exec();
    if (existing?.claimed) {
      throw new ConflictException({
        code: 'ALREADY_CLAIMED',
        message: 'Monthly bonus already claimed',
      });
    }

    // Verify the host actually hit the threshold for the month.
    // Counts include cached LiveDayRecord rows for past months —
    // since we just rejected the current month, no on-the-fly
    // aggregation is required.
    const dayRows = await this.dayModel
      .find({ userId: userOid, year, month, isValid: true })
      .select({ _id: 1 })
      .lean()
      .exec();
    const validDays = dayRows.length;
    if (validDays < cfg.liveValidMonthDays) {
      throw new ForbiddenException({
        code: 'THRESHOLD_NOT_MET',
        message: `Need ${cfg.liveValidMonthDays} valid days (have ${validDays})`,
      });
    }

    const bonusAmount = cfg.liveValidMonthBonus;
    const currency = cfg.liveValidRewardCurrency;

    // Credit the bonus (idempotent on the key — re-runs of a
    // partially-failed claim won't double-credit). Skip entirely
    // when the admin configured a zero bonus — the PDF still
    // generates, but no wallet entry is created.
    let bonusTxnId: Types.ObjectId | null = null;
    if (bonusAmount > 0) {
      const txn = await this.wallet.credit(
        currency === 'coins' ? Currency.COINS : Currency.DIAMONDS,
        {
          userId,
          amount: bonusAmount,
          type: TxnType.LIVE_VALID_MONTH_BONUS,
          description: `Live valid-month bonus for ${year}-${String(month).padStart(2, '0')}`,
          idempotencyKey: `live-valid-month-bonus:${userId}:${year}:${month}`,
          refType: 'live_month_record',
          refId: `${userId}:${year}:${month}`,
        },
      );
      bonusTxnId = txn._id as Types.ObjectId;
    }

    // Upsert the claim ledger row.
    const claimed = await this.monthModel
      .findOneAndUpdate(
        { userId: userOid, year, month },
        {
          $set: {
            claimed: true,
            claimedAt: new Date(),
            bonusAmount,
            bonusCurrency: currency,
            bonusTxnId,
            validDaysAtClaim: validDays,
          },
          $setOnInsert: { userId: userOid, year, month },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return claimed!;
  }

  // ============================================================
  // Aggregation — runs nightly from LiveRecordCron
  // ============================================================

  /**
   * For each user that had at least one LiveSession ending in
   * `targetDate` (an Asia/Dhaka day), upsert their LiveDayRecord
   * for that day and credit the daily reward when they crossed
   * the valid-day threshold AND haven't been rewarded yet.
   *
   * Returns counts so the cron can log activity.
   */
  async aggregateDay(targetDate: {
    year: number;
    month: number;
    day: number;
  }): Promise<{ rowsWritten: number; rewardsCredited: number }> {
    const { year, month, day } = targetDate;
    const start = dhakaDayStartUtc(year, month, day);
    const end = dhakaDayEndUtc(year, month, day);
    const cfg = await this.systemConfig.getConfig();
    const thresholdSec = cfg.liveValidDayMinutes * 60;

    // Group sessions ending in the window by (userId, kind).
    const agg = await this.sessionModel.aggregate<{
      _id: { userId: Types.ObjectId; kind: RoomKind };
      totalSec: number;
    }>([
      { $match: { endedAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { userId: '$userId', kind: '$roomKind' },
          totalSec: { $sum: '$durationSec' },
        },
      },
    ]);
    if (agg.length === 0) {
      return { rowsWritten: 0, rewardsCredited: 0 };
    }

    // Fold per-(userId, kind) into per-userId.
    const perUser = new Map<
      string,
      { userOid: Types.ObjectId; audio: number; video: number }
    >();
    for (const row of agg) {
      const key = row._id.userId.toString();
      const slot = perUser.get(key) ?? {
        userOid: row._id.userId,
        audio: 0,
        video: 0,
      };
      if (row._id.kind === RoomKind.AUDIO) slot.audio += row.totalSec;
      else if (row._id.kind === RoomKind.VIDEO) slot.video += row.totalSec;
      perUser.set(key, slot);
    }

    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    let rowsWritten = 0;
    let rewardsCredited = 0;

    for (const { userOid, audio, video } of perUser.values()) {
      const audioValid = audio >= thresholdSec;
      const videoValid = video >= thresholdSec;
      const isValid = audioValid || videoValid;

      // Decide reward state. We only credit if the day is valid
      // AND the existing row (if any) isn't already marked
      // `rewarded` — guards against the cron re-running for the
      // same date. Use the wallet's idempotency key as the
      // belt-and-braces second line.
      const existing = await this.dayModel
        .findOne({ userId: userOid, date })
        .lean()
        .exec();
      const shouldReward =
        isValid && cfg.liveValidDayReward > 0 && !(existing?.rewarded ?? false);

      let rewardAmount: number | null = existing?.rewardAmount ?? null;
      let rewardCurrency: 'coins' | 'diamonds' | null =
        existing?.rewardCurrency ?? null;
      let rewarded = existing?.rewarded ?? false;
      if (shouldReward) {
        try {
          await this.wallet.credit(
            cfg.liveValidRewardCurrency === 'coins'
              ? Currency.COINS
              : Currency.DIAMONDS,
            {
              userId: userOid.toString(),
              amount: cfg.liveValidDayReward,
              type: TxnType.LIVE_VALID_DAY_REWARD,
              description: `Live valid-day reward for ${date}`,
              idempotencyKey: `live-valid-day-reward:${userOid.toString()}:${date}`,
              refType: 'live_day_record',
              refId: `${userOid.toString()}:${date}`,
            },
          );
          rewardAmount = cfg.liveValidDayReward;
          rewardCurrency = cfg.liveValidRewardCurrency;
          rewarded = true;
          rewardsCredited += 1;
        } catch (err: any) {
          this.log.warn(
            `Daily reward credit failed for ${userOid.toString()} on ${date}: ${err?.message ?? err}`,
          );
        }
      }

      await this.dayModel
        .updateOne(
          { userId: userOid, date },
          {
            $set: {
              audioSec: audio,
              videoSec: video,
              audioValid,
              videoValid,
              isValid,
              rewarded,
              rewardAmount,
              rewardCurrency,
              year,
              month,
              day,
            },
            $setOnInsert: { userId: userOid, date },
          },
          { upsert: true },
        )
        .exec();
      rowsWritten += 1;
    }

    return { rowsWritten, rewardsCredited };
  }

  // ============================================================
  // PDF certificate — generated on demand
  // ============================================================

  /**
   * Build a PDF certificate for the host's monthly claim. Pulls
   * the claim ledger to confirm the claim happened, then renders
   * a simple one-page summary: host name + numeric id, month,
   * valid-day count, bonus amount, and a per-day table.
   *
   * Throws NOT_CLAIMED if the host hasn't claimed yet — the PDF
   * is the artifact of the claim, not a teaser.
   */
  async generatePdf(
    userId: string,
    year: number,
    month: number,
  ): Promise<Buffer> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id',
      });
    }
    const userOid = new Types.ObjectId(userId);
    const monthly = await this.monthModel
      .findOne({ userId: userOid, year, month })
      .lean()
      .exec();
    if (!monthly || !monthly.claimed) {
      throw new NotFoundException({
        code: 'NOT_CLAIMED',
        message: 'No claim found for this month',
      });
    }
    const user = await this.userModel
      .findById(userOid)
      .select('displayName username numericId')
      .lean()
      .exec();
    const days = await this.dayModel
      .find({ userId: userOid, year, month })
      .sort({ day: 1 })
      .lean()
      .exec();

    // Lazy import — pdfkit pulls in its full font set on require
    // (~1.5MB). Loading at call time keeps the cold start cheap
    // for instances that never hit this endpoint.
    const PDFDocument: typeof import('pdfkit') = (await import('pdfkit'))
      .default as unknown as typeof import('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    const hostName =
      user?.displayName?.trim() ||
      user?.username?.trim() ||
      'Host';
    const numericId = user?.numericId ?? '—';
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;

    doc.fontSize(20).text('Zimo Live — Monthly Live Record', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .fillColor('gray')
      .text('Official host activity certificate', { align: 'center' });
    doc.moveDown(1.5).fillColor('black');

    doc.fontSize(12);
    doc.text(`Host:    ${hostName}`);
    doc.text(`ID:      ${numericId}`);
    doc.text(`Month:   ${monthLabel}`);
    doc.text(
      `Claimed: ${monthly.claimedAt ? monthly.claimedAt.toISOString().slice(0, 10) : '—'}`,
    );
    doc.moveDown(0.8);

    doc.fontSize(14).text('Summary', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(12);
    doc.text(`Valid days this month: ${monthly.validDaysAtClaim ?? days.filter((d) => d.isValid).length}`);
    if ((monthly.bonusAmount ?? 0) > 0) {
      doc.text(
        `Monthly bonus: ${monthly.bonusAmount} ${monthly.bonusCurrency ?? ''}`,
      );
    }
    doc.moveDown(1.2);

    doc.fontSize(14).text('Daily breakdown', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    const header = 'Date         Audio (min)   Video (min)   Valid';
    doc.font('Courier').text(header);
    doc.text('-'.repeat(header.length));
    for (const row of days) {
      const a = Math.round(row.audioSec / 60).toString().padStart(11);
      const v = Math.round(row.videoSec / 60).toString().padStart(13);
      const flag = row.isValid ? ' YES' : '  NO';
      doc.text(`${row.date}${a}${v}${flag}`);
    }

    doc.end();
    await done;
    return Buffer.concat(chunks);
  }

  // ============================================================
  // Internals
  // ============================================================

  /** Live aggregation for one specific day — used to fill in
   *  "today" on the monthly read since the cron only writes
   *  yesterday + back. */
  private async _aggregateOneDay(
    userOid: Types.ObjectId,
    year: number,
    month: number,
    day: number,
  ): Promise<{ audio: number; video: number }> {
    const start = dhakaDayStartUtc(year, month, day);
    const end = dhakaDayEndUtc(year, month, day);
    const agg = await this.sessionModel.aggregate<{
      _id: RoomKind;
      totalSec: number;
    }>([
      {
        $match: {
          userId: userOid,
          endedAt: { $gte: start, $lt: end },
        },
      },
      { $group: { _id: '$roomKind', totalSec: { $sum: '$durationSec' } } },
    ]);
    let audio = 0;
    let video = 0;
    for (const row of agg) {
      if (row._id === RoomKind.AUDIO) audio = row.totalSec;
      else if (row._id === RoomKind.VIDEO) video = row.totalSec;
    }
    return { audio, video };
  }

}

export { dhakaParts };
