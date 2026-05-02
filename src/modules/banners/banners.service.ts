import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { MediaService } from '../media/media.service';
import { HomeBanner, HomeBannerDocument } from './schemas/home-banner.schema';
import { RoomBanner, RoomBannerDocument } from './schemas/room-banner.schema';
import { SplashBanner, SplashBannerDocument } from './schemas/splash-banner.schema';

interface ListAdminParams {
  page?: number;
  limit?: number;
  active?: boolean;
}

interface ListAdminRoomParams extends ListAdminParams {
  /** Optional filter — admin list page can narrow to a single slot. */
  slot?: number;
}

@Injectable()
export class BannersService {
  constructor(
    @InjectModel(HomeBanner.name)
    private readonly homeModel: Model<HomeBannerDocument>,
    @InjectModel(SplashBanner.name)
    private readonly splashModel: Model<SplashBannerDocument>,
    @InjectModel(RoomBanner.name)
    private readonly roomModel: Model<RoomBannerDocument>,
    private readonly media: MediaService,
  ) {}

  // ============== Image upload (shared between both banner types) ==============

  async uploadImage(buffer: Buffer): Promise<{ url: string; publicId: string }> {
    const res = await this.media.uploadImage(buffer, { folder: 'banners' });
    return { url: res.secure_url, publicId: res.public_id };
  }

  // ============== Home banners — public + admin ==============

  /**
   * Active, in-window banners visible to a given country (or to all when
   * countries[] is empty). Sorted by sortOrder desc, newest first.
   */
  async listActiveHome(country?: string) {
    const now = new Date();
    const filter: FilterQuery<HomeBannerDocument> = {
      active: true,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
      ],
    };
    if (country) {
      const upper = country.toUpperCase();
      filter.$and!.push({
        $or: [{ countries: { $size: 0 } }, { countries: upper }],
      });
    }
    return this.homeModel.find(filter).sort({ sortOrder: -1, createdAt: -1 }).exec();
  }

  async listAdminHome(params: ListAdminParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<HomeBannerDocument> = {};
    if (params.active !== undefined) filter.active = params.active;

    const [items, total] = await Promise.all([
      this.homeModel
        .find(filter)
        .sort({ sortOrder: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.homeModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async findHome(id: string): Promise<HomeBannerDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.homeModel.findById(id).exec();
  }

  async getHomeOrThrow(id: string): Promise<HomeBannerDocument> {
    const b = await this.findHome(id);
    if (!b) throw new NotFoundException('Banner not found');
    return b;
  }

  async createHome(input: any, createdBy?: string): Promise<HomeBannerDocument> {
    return this.homeModel.create({
      ...input,
      countries: (input.countries ?? []).map((c: string) => c.toUpperCase()),
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      createdBy:
        createdBy && Types.ObjectId.isValid(createdBy)
          ? new Types.ObjectId(createdBy)
          : null,
    });
  }

  async updateHome(id: string, update: any): Promise<HomeBannerDocument> {
    const b = await this.getHomeOrThrow(id);
    if (update.title !== undefined) b.title = update.title;
    if (update.subtitle !== undefined) b.subtitle = update.subtitle;
    if (update.imageUrl !== undefined) b.imageUrl = update.imageUrl;
    if (update.imagePublicId !== undefined) b.imagePublicId = update.imagePublicId;
    if (update.linkKind !== undefined) b.linkKind = update.linkKind;
    if (update.linkValue !== undefined) b.linkValue = update.linkValue;
    if (update.sortOrder !== undefined) b.sortOrder = update.sortOrder;
    if (update.active !== undefined) b.active = update.active;
    if (update.startDate !== undefined)
      b.startDate = update.startDate ? new Date(update.startDate) : null;
    if (update.endDate !== undefined)
      b.endDate = update.endDate ? new Date(update.endDate) : null;
    if (update.countries !== undefined)
      b.countries = update.countries.map((c: string) => c.toUpperCase());
    await b.save();
    return b;
  }

  async deleteHome(id: string): Promise<void> {
    const b = await this.getHomeOrThrow(id);
    if (b.imagePublicId) {
      await this.media.deleteImage(b.imagePublicId);
    }
    await this.homeModel.deleteOne({ _id: b._id }).exec();
  }

  // ============== Splash banners — public + admin ==============

  /** Returns the single splash banner the mobile app should cache. */
  async getFeaturedSplash(): Promise<SplashBannerDocument | null> {
    const now = new Date();
    return this.splashModel
      .findOne({
        active: true,
        $and: [
          { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
          { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
        ],
      })
      .sort({ priority: -1, createdAt: -1 })
      .exec();
  }

  async listAdminSplash(params: ListAdminParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<SplashBannerDocument> = {};
    if (params.active !== undefined) filter.active = params.active;

    const [items, total] = await Promise.all([
      this.splashModel
        .find(filter)
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.splashModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async findSplash(id: string): Promise<SplashBannerDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.splashModel.findById(id).exec();
  }

  async getSplashOrThrow(id: string): Promise<SplashBannerDocument> {
    const b = await this.findSplash(id);
    if (!b) throw new NotFoundException('Splash banner not found');
    return b;
  }

  async createSplash(input: any, createdBy?: string): Promise<SplashBannerDocument> {
    return this.splashModel.create({
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      createdBy:
        createdBy && Types.ObjectId.isValid(createdBy)
          ? new Types.ObjectId(createdBy)
          : null,
    });
  }

  async updateSplash(id: string, update: any): Promise<SplashBannerDocument> {
    const b = await this.getSplashOrThrow(id);
    if (update.title !== undefined) b.title = update.title;
    if (update.imageUrl !== undefined) b.imageUrl = update.imageUrl;
    if (update.imagePublicId !== undefined) b.imagePublicId = update.imagePublicId;
    if (update.priority !== undefined) b.priority = update.priority;
    if (update.active !== undefined) b.active = update.active;
    if (update.startDate !== undefined)
      b.startDate = update.startDate ? new Date(update.startDate) : null;
    if (update.endDate !== undefined)
      b.endDate = update.endDate ? new Date(update.endDate) : null;
    await b.save();
    return b;
  }

  async deleteSplash(id: string): Promise<void> {
    const b = await this.getSplashOrThrow(id);
    if (b.imagePublicId) {
      await this.media.deleteImage(b.imagePublicId);
    }
    await this.splashModel.deleteOne({ _id: b._id }).exec();
  }

  // ============== Room banners — public + admin ==============

  /**
   * Active, in-window room banners visible to a given country. The mobile
   * carousel groups results by `slot` client-side, so server returns
   * everything in a single sortOrder-desc list.
   */
  async listActiveRoom(country?: string) {
    const now = new Date();
    const filter: FilterQuery<RoomBannerDocument> = {
      active: true,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
      ],
    };
    if (country) {
      const upper = country.toUpperCase();
      filter.$and!.push({
        $or: [{ countries: { $size: 0 } }, { countries: upper }],
      });
    }
    return this.roomModel
      .find(filter)
      .sort({ slot: 1, sortOrder: -1, createdAt: -1 })
      .exec();
  }

  async listAdminRoom(params: ListAdminRoomParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<RoomBannerDocument> = {};
    if (params.active !== undefined) filter.active = params.active;
    if (params.slot !== undefined) filter.slot = params.slot;

    const [items, total] = await Promise.all([
      this.roomModel
        .find(filter)
        .sort({ slot: 1, sortOrder: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.roomModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async findRoom(id: string): Promise<RoomBannerDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.roomModel.findById(id).exec();
  }

  async getRoomOrThrow(id: string): Promise<RoomBannerDocument> {
    const b = await this.findRoom(id);
    if (!b) throw new NotFoundException('Room banner not found');
    return b;
  }

  async createRoom(input: any, createdBy?: string): Promise<RoomBannerDocument> {
    return this.roomModel.create({
      ...input,
      countries: (input.countries ?? []).map((c: string) => c.toUpperCase()),
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      createdBy:
        createdBy && Types.ObjectId.isValid(createdBy)
          ? new Types.ObjectId(createdBy)
          : null,
    });
  }

  async updateRoom(id: string, update: any): Promise<RoomBannerDocument> {
    const b = await this.getRoomOrThrow(id);
    if (update.title !== undefined) b.title = update.title;
    if (update.subtitle !== undefined) b.subtitle = update.subtitle;
    if (update.imageUrl !== undefined) b.imageUrl = update.imageUrl;
    if (update.imagePublicId !== undefined) b.imagePublicId = update.imagePublicId;
    if (update.linkKind !== undefined) b.linkKind = update.linkKind;
    if (update.linkValue !== undefined) b.linkValue = update.linkValue;
    if (update.slot !== undefined) b.slot = update.slot;
    if (update.sortOrder !== undefined) b.sortOrder = update.sortOrder;
    if (update.active !== undefined) b.active = update.active;
    if (update.startDate !== undefined)
      b.startDate = update.startDate ? new Date(update.startDate) : null;
    if (update.endDate !== undefined)
      b.endDate = update.endDate ? new Date(update.endDate) : null;
    if (update.countries !== undefined)
      b.countries = update.countries.map((c: string) => c.toUpperCase());
    await b.save();
    return b;
  }

  async deleteRoom(id: string): Promise<void> {
    const b = await this.getRoomOrThrow(id);
    if (b.imagePublicId) {
      await this.media.deleteImage(b.imagePublicId);
    }
    await this.roomModel.deleteOne({ _id: b._id }).exec();
  }
}
