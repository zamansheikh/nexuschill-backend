import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { UserDocument, UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { GiftEvent, GiftEventDocument, GiftContext } from './schemas/gift-event.schema';
import { Gift, GiftCategory, GiftDocument } from './schemas/gift.schema';

interface ListGiftsParams {
  page?: number;
  limit?: number;
  active?: boolean;
  category?: GiftCategory;
  featured?: boolean;
  search?: string;
  /** When provided, additionally filter to the visible catalog for this user's country. */
  forCountry?: string;
}

@Injectable()
export class GiftsService {
  constructor(
    @InjectModel(Gift.name) private readonly giftModel: Model<GiftDocument>,
    @InjectModel(GiftEvent.name) private readonly eventModel: Model<GiftEventDocument>,
    private readonly users: UsersService,
    private readonly wallet: WalletService,
  ) {}

  // ============== Catalog (admin) ==============

  async list(params: ListGiftsParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<GiftDocument> = {};
    if (params.active !== undefined) filter.active = params.active;
    if (params.category) filter.category = params.category;
    if (params.featured !== undefined) filter.featured = params.featured;
    if (params.forCountry) {
      filter.$or = [{ countries: { $size: 0 } }, { countries: params.forCountry.toUpperCase() }];
      const now = new Date();
      filter.active = true;
      filter.$and = [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
      ];
    }
    if (params.search) {
      const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const orClause = [
        { code: regex },
        { 'name.en': regex },
        { 'name.bn': regex },
      ];
      filter.$or = [...((filter.$or as any[]) || []), ...orClause];
    }

    const [items, total] = await Promise.all([
      this.giftModel
        .find(filter)
        .sort({ featured: -1, sortOrder: -1, priceCoins: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.giftModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async findById(id: string): Promise<GiftDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.giftModel.findById(id).exec();
  }

  async getByIdOrThrow(id: string): Promise<GiftDocument> {
    const gift = await this.findById(id);
    if (!gift) throw new NotFoundException('Gift not found');
    return gift;
  }

  async create(input: any, createdBy?: string): Promise<GiftDocument> {
    const codeUpper = input.code.toUpperCase();
    const exists = await this.giftModel.countDocuments({ code: codeUpper }).exec();
    if (exists) {
      throw new ConflictException({
        code: 'GIFT_CODE_TAKEN',
        message: `Gift code "${codeUpper}" already in use`,
      });
    }
    return this.giftModel.create({
      ...input,
      code: codeUpper,
      createdBy: createdBy && Types.ObjectId.isValid(createdBy) ? new Types.ObjectId(createdBy) : null,
      countries: (input.countries ?? []).map((c: string) => c.toUpperCase()),
    });
  }

  async update(id: string, update: any): Promise<GiftDocument> {
    const gift = await this.getByIdOrThrow(id);
    const {
      code,
      name,
      description,
      category,
      priceCoins,
      beanReward,
      thumbnailUrl,
      animationUrl,
      soundUrl,
      durationMs,
      active,
      startDate,
      endDate,
      vipOnly,
      svipOnly,
      countries,
      comboMultipliers,
      sortOrder,
      featured,
    } = update;

    if (code !== undefined) {
      const codeUpper = code.toUpperCase();
      if (codeUpper !== gift.code) {
        const exists = await this.giftModel.countDocuments({ code: codeUpper }).exec();
        if (exists) {
          throw new ConflictException({ code: 'GIFT_CODE_TAKEN', message: 'Code in use' });
        }
        gift.code = codeUpper;
      }
    }
    if (name !== undefined) gift.name = name;
    if (description !== undefined) gift.description = description;
    if (category !== undefined) gift.category = category;
    if (priceCoins !== undefined) gift.priceCoins = priceCoins;
    if (beanReward !== undefined) gift.beanReward = beanReward;
    if (thumbnailUrl !== undefined) gift.thumbnailUrl = thumbnailUrl;
    if (animationUrl !== undefined) gift.animationUrl = animationUrl;
    if (soundUrl !== undefined) gift.soundUrl = soundUrl;
    if (durationMs !== undefined) gift.durationMs = durationMs;
    if (active !== undefined) gift.active = active;
    if (startDate !== undefined) gift.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) gift.endDate = endDate ? new Date(endDate) : null;
    if (vipOnly !== undefined) gift.vipOnly = vipOnly;
    if (svipOnly !== undefined) gift.svipOnly = svipOnly;
    if (countries !== undefined) gift.countries = countries.map((c: string) => c.toUpperCase());
    if (comboMultipliers !== undefined) gift.comboMultipliers = comboMultipliers;
    if (sortOrder !== undefined) gift.sortOrder = sortOrder;
    if (featured !== undefined) gift.featured = featured;

    await gift.save();
    return gift;
  }

  async softDelete(id: string): Promise<void> {
    const gift = await this.getByIdOrThrow(id);
    gift.active = false;
    await gift.save();
  }

  // ============== Send gift (user-facing) ==============

  async sendGift(input: {
    senderId: string;
    receiverId: string;
    giftId: string;
    count: number;
    contextType?: GiftContext;
    contextId?: string;
    message?: string;
    idempotencyKey: string;
  }): Promise<{ event: GiftEventDocument; senderWallet: any }> {
    if (input.senderId === input.receiverId) {
      throw new BadRequestException({ code: 'SELF_GIFT', message: 'Cannot send a gift to yourself' });
    }
    if (input.count <= 0) {
      throw new BadRequestException({ code: 'INVALID_COUNT', message: 'Count must be > 0' });
    }

    // Idempotency: if event with this key exists, return it.
    const existing = await this.eventModel.findOne({ idempotencyKey: input.idempotencyKey }).exec();
    if (existing) {
      const wallet = await this.wallet.findByUserId(input.senderId);
      return { event: existing, senderWallet: wallet };
    }

    // Validate gift
    const gift = await this.getByIdOrThrow(input.giftId);
    if (!gift.active) {
      throw new BadRequestException({ code: 'GIFT_INACTIVE', message: 'Gift is not active' });
    }
    const now = new Date();
    if (gift.startDate && now < gift.startDate) {
      throw new BadRequestException({ code: 'GIFT_NOT_STARTED', message: 'Gift not yet available' });
    }
    if (gift.endDate && now > gift.endDate) {
      throw new BadRequestException({ code: 'GIFT_EXPIRED', message: 'Gift no longer available' });
    }
    if (!gift.comboMultipliers.includes(input.count)) {
      throw new BadRequestException({
        code: 'INVALID_COMBO',
        message: `count must be one of ${gift.comboMultipliers.join(', ')}`,
      });
    }

    // Validate sender + receiver
    const [sender, receiver] = await Promise.all([
      this.users.getByIdOrThrow(input.senderId),
      this.users.getByIdOrThrow(input.receiverId),
    ]);
    this.assertUsable(sender, 'SENDER');
    this.assertUsable(receiver, 'RECEIVER');

    if (gift.countries.length > 0 && !gift.countries.includes(sender.country)) {
      throw new ForbiddenException({
        code: 'GIFT_COUNTRY_RESTRICTED',
        message: 'This gift is not available in your region',
      });
    }
    // (VIP / SVIP filters land when those modules ship.)

    const totalCoinAmount = gift.priceCoins * input.count;
    const totalBeanReward = gift.beanReward * input.count;

    // Atomic two-wallet transfer (uses MongoDB transaction in WalletService).
    const { senderTxn, receiverTxn } = await this.wallet.transferGift({
      senderUserId: input.senderId,
      receiverUserId: input.receiverId,
      coinAmount: totalCoinAmount,
      beanReward: totalBeanReward,
      giftId: input.giftId,
      idempotencyKey: input.idempotencyKey,
      description: `Gift: ${gift.code} ×${input.count}`,
    });

    let event: GiftEventDocument;
    try {
      event = await this.eventModel.create({
        giftId: gift._id,
        senderId: new Types.ObjectId(input.senderId),
        receiverId: new Types.ObjectId(input.receiverId),
        count: input.count,
        totalCoinAmount,
        totalBeanReward,
        contextType: input.contextType ?? GiftContext.PROFILE,
        contextId:
          input.contextId && Types.ObjectId.isValid(input.contextId)
            ? new Types.ObjectId(input.contextId)
            : null,
        message: input.message ?? '',
        senderTxnId: senderTxn._id,
        receiverTxnId: receiverTxn._id,
        idempotencyKey: input.idempotencyKey,
        status: 'completed',
      });
    } catch (err: any) {
      // Concurrent retry slipped through. Fetch and return the existing.
      if (err?.code === 11000) {
        event = (await this.eventModel.findOne({ idempotencyKey: input.idempotencyKey }).exec())!;
      } else {
        throw err;
      }
    }

    // Bump catalog counters (best-effort, eventual consistency).
    this.giftModel
      .updateOne(
        { _id: gift._id },
        { $inc: { totalSent: input.count, totalCoinsCollected: totalCoinAmount } },
      )
      .exec()
      .catch(() => undefined);

    const wallet = await this.wallet.findByUserId(input.senderId);
    return { event, senderWallet: wallet };
  }

  // ============== History ==============

  async listSentBy(senderId: string, page = 1, limit = 50) {
    const skip = (Math.max(1, page) - 1) * limit;
    const filter = { senderId: new Types.ObjectId(senderId) };
    const [items, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('giftId', 'code name thumbnailUrl priceCoins')
        .populate('receiverId', 'username displayName avatarUrl')
        .exec(),
      this.eventModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async listReceivedBy(receiverId: string, page = 1, limit = 50) {
    const skip = (Math.max(1, page) - 1) * limit;
    const filter = { receiverId: new Types.ObjectId(receiverId), status: 'completed' };
    const [items, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('giftId', 'code name thumbnailUrl priceCoins')
        .populate('senderId', 'username displayName avatarUrl')
        .exec(),
      this.eventModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  /** Aggregate top gifts a user has received, grouped by gift type. */
  async giftWall(userId: string, limit = 20) {
    if (!Types.ObjectId.isValid(userId)) return [];
    return this.eventModel
      .aggregate([
        { $match: { receiverId: new Types.ObjectId(userId), status: 'completed' } },
        {
          $group: {
            _id: '$giftId',
            totalCount: { $sum: '$count' },
            totalBeans: { $sum: '$totalBeanReward' },
            lastReceived: { $max: '$createdAt' },
          },
        },
        { $sort: { totalCount: -1, lastReceived: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'gifts',
            localField: '_id',
            foreignField: '_id',
            as: 'gift',
          },
        },
        { $unwind: '$gift' },
        {
          $project: {
            _id: 0,
            giftId: '$_id',
            code: '$gift.code',
            name: '$gift.name',
            thumbnailUrl: '$gift.thumbnailUrl',
            totalCount: 1,
            totalBeans: 1,
            lastReceived: 1,
          },
        },
      ])
      .exec();
  }

  async listAllEvents(params: {
    page?: number;
    limit?: number;
    senderId?: string;
    receiverId?: string;
    giftId?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<GiftEventDocument> = {};
    if (params.senderId && Types.ObjectId.isValid(params.senderId)) {
      filter.senderId = new Types.ObjectId(params.senderId);
    }
    if (params.receiverId && Types.ObjectId.isValid(params.receiverId)) {
      filter.receiverId = new Types.ObjectId(params.receiverId);
    }
    if (params.giftId && Types.ObjectId.isValid(params.giftId)) {
      filter.giftId = new Types.ObjectId(params.giftId);
    }

    const [items, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('giftId', 'code name')
        .populate('senderId', 'username')
        .populate('receiverId', 'username')
        .exec(),
      this.eventModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  // ============== helpers ==============

  private assertUsable(user: UserDocument, who: 'SENDER' | 'RECEIVER') {
    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException({
        code: `${who}_BANNED`,
        message: who === 'SENDER' ? 'Your account is banned' : 'Cannot gift a banned user',
      });
    }
    if (user.status === UserStatus.DELETED) {
      throw new BadRequestException({
        code: `${who}_DELETED`,
        message: who === 'SENDER' ? 'Account deleted' : 'User no longer exists',
      });
    }
  }
}
