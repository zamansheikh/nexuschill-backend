import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { AuthProvider, HostTier, User, UserDocument, UserStatus } from './schemas/user.schema';

export interface ListUsersParams {
  page?: number;
  limit?: number;
  status?: UserStatus;
  isHost?: boolean;
  country?: string;
  search?: string;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string, withPassword = false): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: email.toLowerCase() });
    if (withPassword) query.select('+passwordHash');
    return query.exec();
  }

  async findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  async findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username: username.toLowerCase() }).exec();
  }

  async getByIdOrThrow(id: string): Promise<UserDocument> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async createWithEmail(params: {
    email: string;
    passwordHash: string;
    username?: string;
    displayName?: string;
  }): Promise<UserDocument> {
    return this.userModel.create({
      email: params.email.toLowerCase(),
      passwordHash: params.passwordHash,
      username: params.username?.toLowerCase(),
      displayName: params.displayName || params.username || '',
      providers: [AuthProvider.EMAIL],
      emailVerified: false,
    });
  }

  async createWithPhone(params: {
    phone: string;
    username?: string;
    displayName?: string;
  }): Promise<UserDocument> {
    return this.userModel.create({
      phone: params.phone,
      username: params.username?.toLowerCase(),
      displayName: params.displayName || '',
      providers: [AuthProvider.PHONE],
      phoneVerified: true,
    });
  }

  async markLogin(id: string): Promise<void> {
    await this.userModel.updateOne({ _id: id }, { $set: { lastLoginAt: new Date() } }).exec();
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const count = await this.userModel
      .countDocuments({ username: username.toLowerCase() })
      .exec();
    return count > 0;
  }

  async isEmailTaken(email: string): Promise<boolean> {
    const count = await this.userModel.countDocuments({ email: email.toLowerCase() }).exec();
    return count > 0;
  }

  // -------------------- Admin-side ops --------------------

  async list(params: ListUsersParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<UserDocument> = {};
    if (params.status) filter.status = params.status;
    if (params.isHost !== undefined) filter.isHost = params.isHost;
    if (params.country) filter.country = params.country.toUpperCase();
    if (params.search) {
      const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { email: regex },
        { phone: regex },
        { username: regex },
        { displayName: regex },
      ];
    }

    const [items, total] = await Promise.all([
      this.userModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return { items, page, limit, total };
  }

  async ban(id: string, reason: string, bannedBy?: string): Promise<UserDocument> {
    const user = await this.getByIdOrThrow(id);
    user.status = UserStatus.BANNED;
    user.banReason = reason;
    user.bannedAt = new Date();
    user.bannedBy = bannedBy ? new Types.ObjectId(bannedBy) : null;
    await user.save();
    return user;
  }

  async unban(id: string): Promise<UserDocument> {
    const user = await this.getByIdOrThrow(id);
    user.status = UserStatus.ACTIVE;
    user.banReason = '';
    user.bannedAt = null;
    user.bannedBy = null;
    await user.save();
    return user;
  }

  async setHost(
    id: string,
    makeHost: boolean,
    params?: { tier?: HostTier; approvedBy?: string; agencyId?: string | null },
  ): Promise<UserDocument> {
    const user = await this.getByIdOrThrow(id);

    if (makeHost) {
      user.isHost = true;
      user.hostProfile = {
        tier: params?.tier ?? HostTier.TRAINEE,
        approvedAt: new Date(),
        approvedBy: params?.approvedBy ? new Types.ObjectId(params.approvedBy) : null,
        agencyId:
          params?.agencyId && Types.ObjectId.isValid(params.agencyId)
            ? new Types.ObjectId(params.agencyId)
            : null,
        totalBeansEarned: user.hostProfile?.totalBeansEarned ?? 0,
        streamHours: user.hostProfile?.streamHours ?? 0,
      } as any;
    } else {
      user.isHost = false;
      // keep hostProfile for history? up to policy — we clear it for simplicity
      user.hostProfile = null;
    }

    await user.save();
    return user;
  }

  async linkAdmin(userId: string, adminId: string | null): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user id' });
    }
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { linkedAdminId: adminId ? new Types.ObjectId(adminId) : null } },
      )
      .exec();
  }
}
