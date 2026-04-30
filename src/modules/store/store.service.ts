import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

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
  constructor(
    @InjectModel(StoreListing.name)
    private readonly listingModel: Model<StoreListingDocument>,
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
}
