import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { SVIP_PRIVILEGES, PrivilegeDef } from './privileges.catalog';
import { SvipTier, SvipTierDocument } from './schemas/svip-tier.schema';
import { UserSvipStatus, UserSvipStatusDocument } from './schemas/user-svip-status.schema';

@Injectable()
export class SvipService {
  constructor(
    @InjectModel(SvipTier.name) private readonly tierModel: Model<SvipTierDocument>,
    @InjectModel(UserSvipStatus.name)
    private readonly statusModel: Model<UserSvipStatusDocument>,
  ) {}

  // ---------- Privileges catalog ----------

  listPrivileges(): readonly PrivilegeDef[] {
    return SVIP_PRIVILEGES;
  }

  // ---------- Tier CRUD ----------

  async listTiers(activeOnly = false) {
    const filter = activeOnly ? { active: true } : {};
    return this.tierModel.find(filter).sort({ level: 1 }).exec();
  }

  async findById(id: string): Promise<SvipTierDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.tierModel.findById(id).exec();
  }

  async getByIdOrThrow(id: string): Promise<SvipTierDocument> {
    const t = await this.findById(id);
    if (!t) throw new NotFoundException('SVIP tier not found');
    return t;
  }

  async getByLevel(level: number): Promise<SvipTierDocument | null> {
    return this.tierModel.findOne({ level }).exec();
  }

  async create(input: any): Promise<SvipTierDocument> {
    const exists = await this.tierModel.countDocuments({ level: input.level }).exec();
    if (exists) {
      throw new ConflictException({
        code: 'SVIP_LEVEL_TAKEN',
        message: `SVIP level ${input.level} already exists`,
      });
    }
    this.assertPrivilegesValid(input.privileges);
    return this.tierModel.create({
      ...input,
      grantedItemIds: (input.grantedItemIds ?? []).map((s: string) => new Types.ObjectId(s)),
    });
  }

  async update(id: string, update: any): Promise<SvipTierDocument> {
    const t = await this.getByIdOrThrow(id);
    if (update.privileges !== undefined) this.assertPrivilegesValid(update.privileges);

    if (update.name !== undefined) t.name = update.name;
    if (update.monthlyPointsRequired !== undefined)
      t.monthlyPointsRequired = update.monthlyPointsRequired;
    if (update.coinReward !== undefined) t.coinReward = update.coinReward;
    if (update.iconUrl !== undefined) t.iconUrl = update.iconUrl;
    if (update.iconPublicId !== undefined) t.iconPublicId = update.iconPublicId;
    if (update.bannerUrl !== undefined) t.bannerUrl = update.bannerUrl;
    if (update.bannerPublicId !== undefined) t.bannerPublicId = update.bannerPublicId;
    if (update.grantedItemIds !== undefined) {
      t.grantedItemIds = update.grantedItemIds.map((s: string) => new Types.ObjectId(s));
    }
    if (update.privileges !== undefined) t.privileges = update.privileges;
    if (update.active !== undefined) t.active = update.active;

    await t.save();
    return t;
  }

  async softDelete(id: string): Promise<void> {
    const t = await this.getByIdOrThrow(id);
    t.active = false;
    await t.save();
  }

  // ---------- User SVIP status ----------

  async getOrCreateStatus(userId: string): Promise<UserSvipStatusDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Invalid user id');
    }
    const userObj = new Types.ObjectId(userId);
    return this.statusModel
      .findOneAndUpdate(
        { userId: userObj },
        { $setOnInsert: { userId: userObj } },
        { upsert: true, new: true },
      )
      .exec();
  }

  async getStatus(userId: string): Promise<UserSvipStatusDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    return this.statusModel.findOne({ userId: new Types.ObjectId(userId) }).exec();
  }

  /**
   * Aggregated set of privilege keys the user currently enjoys, derived
   * from their currentLevel. Returns [] for non-SVIP users.
   */
  async resolvedPrivileges(userId: string): Promise<string[]> {
    const status = await this.getStatus(userId);
    if (!status || status.currentLevel === 0) return [];
    if (status.expiresAt && status.expiresAt < new Date()) return [];

    // All tiers ≤ currentLevel contribute their privileges (tiers stack).
    const tiers = await this.tierModel
      .find({ level: { $lte: status.currentLevel }, active: true })
      .exec();
    const set = new Set<string>();
    for (const t of tiers) for (const p of t.privileges) set.add(p);
    return [...set];
  }

  // ---------- helpers ----------

  private assertPrivilegesValid(privileges: string[] | undefined) {
    if (!privileges) return;
    const valid = new Set(SVIP_PRIVILEGES.map((p) => p.key));
    const unknown = privileges.filter((p) => !valid.has(p));
    if (unknown.length > 0) {
      throw new ConflictException({
        code: 'UNKNOWN_PRIVILEGE',
        message: 'One or more privilege keys are not in the catalog',
        details: { unknown },
      });
    }
  }
}
