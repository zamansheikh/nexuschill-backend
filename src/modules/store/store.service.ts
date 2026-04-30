import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { CosmeticsService } from '../cosmetics/cosmetics.service';
import {
  CosmeticItem,
  CosmeticItemDocument,
} from '../cosmetics/schemas/cosmetic-item.schema';
import { CosmeticSource, UserCosmetic, UserCosmeticDocument } from '../cosmetics/schemas/user-cosmetic.schema';
import { UsersService } from '../users/users.service';
import { Currency, TxnType } from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import { StoreCategory, StoreListing, StoreListingDocument } from './schemas/store-listing.schema';

interface ListParams {
  page?: number;
  limit?: number;
  category?: StoreCategory;
  active?: boolean;
  featured?: boolean;
}

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    @InjectModel(StoreListing.name)
    private readonly listingModel: Model<StoreListingDocument>,
    @InjectModel(CosmeticItem.name)
    private readonly itemModel: Model<CosmeticItemDocument>,
    @InjectModel(UserCosmetic.name)
    private readonly userCosmeticModel: Model<UserCosmeticDocument>,
    private readonly cosmetics: CosmeticsService,
    private readonly wallet: WalletService,
    private readonly users: UsersService,
  ) {}

  /**
   * Live store listing for end-users. Filters out:
   *   • inactive listings
   *   • listings outside their start/end window
   *   • listings whose underlying CosmeticItem is inactive
   * The cosmeticItem is populated so the mobile app gets preview/asset
   * URLs in the same payload.
   */
  async listForUsers(params: { category?: StoreCategory; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const skip = (page - 1) * limit;
    const now = new Date();

    const filter: FilterQuery<StoreListingDocument> = {
      active: true,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
      ],
    };
    if (params.category) filter.category = params.category;

    const cursor = this.listingModel
      .find(filter)
      .sort({ featured: -1, sortOrder: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'cosmeticItemId',
        match: { active: true },
      });

    const [items, total] = await Promise.all([
      cursor.exec(),
      this.listingModel.countDocuments(filter).exec(),
    ]);

    // Drop listings whose underlying item is inactive (populate match returns null).
    const visible = items.filter((l) => (l as any).cosmeticItemId);
    return { items: visible, page, limit, total };
  }

  // ---------- Admin CRUD ----------

  async listAdmin(params: ListParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<StoreListingDocument> = {};
    if (params.category) filter.category = params.category;
    if (params.active !== undefined) filter.active = params.active;
    if (params.featured !== undefined) filter.featured = params.featured;

    const [items, total] = await Promise.all([
      this.listingModel
        .find(filter)
        .sort({ featured: -1, sortOrder: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('cosmeticItemId')
        .exec(),
      this.listingModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async findById(id: string): Promise<StoreListingDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.listingModel.findById(id).populate('cosmeticItemId').exec();
  }

  async getByIdOrThrow(id: string): Promise<StoreListingDocument> {
    const l = await this.findById(id);
    if (!l) throw new NotFoundException('Store listing not found');
    return l;
  }

  async create(input: any): Promise<StoreListingDocument> {
    const created = await this.listingModel.create({
      ...input,
      cosmeticItemId: new Types.ObjectId(input.cosmeticItemId),
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
    return (await this.findById(created._id.toString()))!;
  }

  async update(id: string, update: any): Promise<StoreListingDocument> {
    const l = await this.getByIdOrThrow(id);
    if (update.category !== undefined) l.category = update.category;
    if (update.priceCoins !== undefined) l.priceCoins = update.priceCoins;
    if (update.durationDays !== undefined) l.durationDays = update.durationDays;
    if (update.sortOrder !== undefined) l.sortOrder = update.sortOrder;
    if (update.featured !== undefined) l.featured = update.featured;
    if (update.active !== undefined) l.active = update.active;
    if (update.giftable !== undefined) l.giftable = update.giftable;
    if (update.startDate !== undefined) l.startDate = update.startDate ? new Date(update.startDate) : null;
    if (update.endDate !== undefined) l.endDate = update.endDate ? new Date(update.endDate) : null;
    await l.save();
    return l;
  }

  async softDelete(id: string): Promise<void> {
    const l = await this.getByIdOrThrow(id);
    l.active = false;
    await l.save();
  }

  // ============== Purchase / Gift (user-facing) ==============

  /**
   * Buy a listing for yourself. Idempotent on `idempotencyKey`:
   *   • wallet.debit() de-dupes via the same key
   *   • cosmetics.grantToUser() de-dupes via externalRef
   *
   * Order: validate → debit → grant. If the grant errors after a successful
   * debit (rare — only happens if the cosmetic gets deleted between fetch
   * and grant), we log loud and the user sees a 5xx; admin can clean up
   * by manually crediting. The idempotency keys make a retry safe.
   */
  async purchase(params: {
    buyerUserId: string;
    listingId: string;
    idempotencyKey: string;
  }): Promise<{
    listing: StoreListingDocument;
    cosmeticItemId: string;
    expiresAt: Date | null;
  }> {
    const listing = await this.assertPurchasable(params.listingId);
    const item = await this.itemModel.findById(listing.cosmeticItemId).exec();
    if (!item || !item.active) {
      throw new BadRequestException({
        code: 'ITEM_INACTIVE',
        message: 'This item is not available',
      });
    }

    await this.wallet.debit(Currency.COINS, {
      userId: params.buyerUserId,
      amount: listing.priceCoins,
      type: TxnType.GIFT_SEND, // re-use until we add STORE_PURCHASE
      description: `Store: ${item.code} (${listing.durationDays}d)`,
      idempotencyKey: params.idempotencyKey,
      refType: 'store_listing',
      refId: listing._id.toString(),
    });

    const granted = await this.cosmetics.grantToUser({
      userId: params.buyerUserId,
      cosmeticItemId: item._id.toString(),
      source: CosmeticSource.STORE,
      durationDays: listing.durationDays > 0 ? listing.durationDays : null,
      externalRef: params.idempotencyKey,
    });

    return {
      listing,
      cosmeticItemId: item._id.toString(),
      expiresAt: granted.expiresAt ?? null,
    };
  }

  /**
   * Send a listing to another user. Sender pays, receiver receives. We
   * resolve the receiver by ObjectId or numericId (mobile UIs typically
   * only know the latter).
   */
  async gift(params: {
    senderUserId: string;
    listingId: string;
    receiverId?: string;
    receiverNumericId?: number;
    idempotencyKey: string;
    message?: string;
  }): Promise<{
    listing: StoreListingDocument;
    receiverId: string;
    cosmeticItemId: string;
    expiresAt: Date | null;
  }> {
    const listing = await this.assertPurchasable(params.listingId);
    if (!listing.giftable) {
      throw new ForbiddenException({
        code: 'NOT_GIFTABLE',
        message: 'This listing is not giftable',
      });
    }

    const item = await this.itemModel.findById(listing.cosmeticItemId).exec();
    if (!item || !item.active) {
      throw new BadRequestException({
        code: 'ITEM_INACTIVE',
        message: 'This item is not available',
      });
    }

    // Resolve receiver
    let receiver = null;
    if (params.receiverId) {
      receiver = await this.users.findById(params.receiverId);
    } else if (params.receiverNumericId !== undefined) {
      receiver = await this.users.findByNumericId(params.receiverNumericId);
    }
    if (!receiver) {
      throw new NotFoundException({
        code: 'RECEIVER_NOT_FOUND',
        message: 'Receiver not found',
      });
    }
    if (receiver._id.toString() === params.senderUserId) {
      throw new BadRequestException({
        code: 'SELF_GIFT',
        message: 'Cannot gift yourself',
      });
    }

    await this.wallet.debit(Currency.COINS, {
      userId: params.senderUserId,
      amount: listing.priceCoins,
      type: TxnType.GIFT_SEND,
      description: `Store gift: ${item.code} → ${receiver._id} (${listing.durationDays}d)`,
      idempotencyKey: params.idempotencyKey,
      refType: 'store_listing_gift',
      refId: listing._id.toString(),
    });

    const granted = await this.cosmetics.grantToUser({
      userId: receiver._id.toString(),
      cosmeticItemId: item._id.toString(),
      source: CosmeticSource.GIFT,
      durationDays: listing.durationDays > 0 ? listing.durationDays : null,
      giftedBy: params.senderUserId,
      externalRef: params.idempotencyKey,
    });

    return {
      listing,
      receiverId: receiver._id.toString(),
      cosmeticItemId: item._id.toString(),
      expiresAt: granted.expiresAt ?? null,
    };
  }

  // ============== helpers ==============

  private async assertPurchasable(listingId: string): Promise<StoreListingDocument> {
    const listing = await this.listingModel.findById(listingId).exec();
    if (!listing || !listing.active) {
      throw new NotFoundException({
        code: 'LISTING_NOT_FOUND',
        message: 'Store listing not found',
      });
    }
    const now = new Date();
    if (listing.startDate && now < listing.startDate) {
      throw new BadRequestException({
        code: 'LISTING_NOT_STARTED',
        message: 'Listing not yet on sale',
      });
    }
    if (listing.endDate && now > listing.endDate) {
      throw new BadRequestException({
        code: 'LISTING_ENDED',
        message: 'Listing sale has ended',
      });
    }
    return listing;
  }
}
