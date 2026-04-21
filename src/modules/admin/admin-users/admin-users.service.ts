import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';

import { AdminRole, AdminRoleDocument } from './schemas/admin-role.schema';
import { AdminStatus, AdminUser, AdminUserDocument } from './schemas/admin-user.schema';

export interface CreateAdminInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  roleId: string;
  scopeType?: 'agency' | 'reseller' | null;
  scopeId?: string | null;
  createdBy?: string;
}

export interface CreateRoleInput {
  name: string;
  displayName: string;
  description?: string;
  permissions: string[];
  scopeType?: 'agency' | 'reseller' | null;
  priority?: number;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(AdminUser.name)
    private readonly adminModel: Model<AdminUserDocument>,
    @InjectModel(AdminRole.name)
    private readonly roleModel: Model<AdminRoleDocument>,
    private readonly config: ConfigService,
  ) {}

  // ------------- Roles -------------

  async listRoles(): Promise<AdminRoleDocument[]> {
    return this.roleModel.find({ active: true }).sort({ priority: -1, name: 1 }).exec();
  }

  async findRoleById(id: string): Promise<AdminRoleDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.roleModel.findById(id).exec();
  }

  async findRoleByName(name: string): Promise<AdminRoleDocument | null> {
    return this.roleModel.findOne({ name: name.toLowerCase() }).exec();
  }

  async createRole(input: CreateRoleInput): Promise<AdminRoleDocument> {
    const existing = await this.findRoleByName(input.name);
    if (existing) {
      throw new ConflictException({ code: 'ROLE_EXISTS', message: 'Role name already exists' });
    }
    return this.roleModel.create({
      name: input.name.toLowerCase(),
      displayName: input.displayName,
      description: input.description ?? '',
      permissions: input.permissions,
      scopeType: input.scopeType ?? null,
      priority: input.priority ?? 0,
      isSystem: false,
    });
  }

  async updateRole(
    id: string,
    update: Partial<CreateRoleInput> & { active?: boolean },
  ): Promise<AdminRoleDocument> {
    const role = await this.findRoleById(id);
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem && update.name && update.name !== role.name) {
      throw new BadRequestException({
        code: 'SYSTEM_ROLE_IMMUTABLE_NAME',
        message: 'System role name cannot be changed',
      });
    }

    if (update.name) role.name = update.name.toLowerCase();
    if (update.displayName !== undefined) role.displayName = update.displayName;
    if (update.description !== undefined) role.description = update.description;
    if (update.permissions) role.permissions = update.permissions;
    if (update.priority !== undefined) role.priority = update.priority;
    if (update.scopeType !== undefined) role.scopeType = update.scopeType;
    if (update.active !== undefined) role.active = update.active;

    await role.save();
    return role;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.findRoleById(id);
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) {
      throw new BadRequestException({
        code: 'SYSTEM_ROLE_PROTECTED',
        message: 'System roles cannot be deleted',
      });
    }
    const usage = await this.adminModel.countDocuments({ roleId: role._id }).exec();
    if (usage > 0) {
      throw new BadRequestException({
        code: 'ROLE_IN_USE',
        message: `Cannot delete — ${usage} admin account(s) still use this role`,
        details: { inUse: usage },
      });
    }
    await role.deleteOne();
  }

  // ------------- Admin Users -------------

  async findByIdentifier(identifier: string, withPassword = false): Promise<AdminUserDocument | null> {
    const q: any = identifier.includes('@')
      ? { email: identifier.toLowerCase() }
      : { username: identifier.toLowerCase() };
    const query = this.adminModel.findOne(q);
    if (withPassword) query.select('+passwordHash');
    return query.exec();
  }

  async findById(id: string): Promise<AdminUserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.adminModel.findById(id).exec();
  }

  async getByIdOrThrow(id: string): Promise<AdminUserDocument> {
    const admin = await this.findById(id);
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  async list(params: {
    page?: number;
    limit?: number;
    roleId?: string;
    status?: AdminStatus;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (params.roleId && Types.ObjectId.isValid(params.roleId)) {
      filter.roleId = new Types.ObjectId(params.roleId);
    }
    if (params.status) filter.status = params.status;
    if (params.search) {
      const regex = new RegExp(params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ email: regex }, { username: regex }, { displayName: regex }];
    }

    const [items, total] = await Promise.all([
      this.adminModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('roleId')
        .exec(),
      this.adminModel.countDocuments(filter).exec(),
    ]);

    return { items, page, limit, total };
  }

  async create(input: CreateAdminInput): Promise<AdminUserDocument> {
    const emailLower = input.email.toLowerCase();
    const usernameLower = input.username.toLowerCase();

    const [emailExists, usernameExists] = await Promise.all([
      this.adminModel.countDocuments({ email: emailLower }).exec(),
      this.adminModel.countDocuments({ username: usernameLower }).exec(),
    ]);
    if (emailExists) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already in use' });
    if (usernameExists) {
      throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Username already in use' });
    }

    if (!Types.ObjectId.isValid(input.roleId)) {
      throw new BadRequestException({ code: 'INVALID_ROLE', message: 'Invalid roleId' });
    }
    const role = await this.findRoleById(input.roleId);
    if (!role) throw new NotFoundException('Role not found');

    if (role.scopeType && !input.scopeId) {
      throw new BadRequestException({
        code: 'SCOPE_REQUIRED',
        message: `Role "${role.name}" requires a scopeId (${role.scopeType})`,
      });
    }

    const rounds = this.config.get<number>('security.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(input.password, rounds);

    return this.adminModel.create({
      email: emailLower,
      username: usernameLower,
      passwordHash,
      displayName: input.displayName || input.username,
      roleId: role._id,
      scopeType: role.scopeType ?? null,
      scopeId:
        input.scopeId && Types.ObjectId.isValid(input.scopeId)
          ? new Types.ObjectId(input.scopeId)
          : null,
      createdBy: input.createdBy ? new Types.ObjectId(input.createdBy) : null,
      status: AdminStatus.ACTIVE,
    });
  }

  async update(
    id: string,
    update: Partial<{
      displayName: string;
      avatarUrl: string;
      status: AdminStatus;
      roleId: string;
      scopeId: string | null;
    }>,
  ): Promise<AdminUserDocument> {
    const admin = await this.getByIdOrThrow(id);

    if (update.displayName !== undefined) admin.displayName = update.displayName;
    if (update.avatarUrl !== undefined) admin.avatarUrl = update.avatarUrl;
    if (update.status !== undefined) admin.status = update.status;

    if (update.roleId !== undefined) {
      if (!Types.ObjectId.isValid(update.roleId)) {
        throw new BadRequestException({ code: 'INVALID_ROLE', message: 'Invalid roleId' });
      }
      const role = await this.findRoleById(update.roleId);
      if (!role) throw new NotFoundException('Role not found');
      admin.roleId = role._id;
      admin.scopeType = role.scopeType ?? null;
    }

    if (update.scopeId !== undefined) {
      admin.scopeId =
        update.scopeId && Types.ObjectId.isValid(update.scopeId)
          ? new Types.ObjectId(update.scopeId)
          : null;
    }

    await admin.save();
    return admin;
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const admin = await this.getByIdOrThrow(id);
    const rounds = this.config.get<number>('security.bcryptRounds', 12);
    admin.passwordHash = await bcrypt.hash(newPassword, rounds);
    admin.mustChangePassword = true;
    admin.failedLoginAttempts = 0;
    admin.lockedUntil = null;
    await admin.save();
  }

  async markLogin(id: string, ip?: string): Promise<void> {
    await this.adminModel
      .updateOne(
        { _id: id },
        {
          $set: { lastLoginAt: new Date(), lastLoginIp: ip, failedLoginAttempts: 0, lockedUntil: null },
        },
      )
      .exec();
  }

  async recordFailedLogin(id: string): Promise<AdminUserDocument> {
    const admin = await this.getByIdOrThrow(id);
    admin.failedLoginAttempts += 1;
    if (admin.failedLoginAttempts >= 5) {
      admin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      admin.status = AdminStatus.LOCKED;
    }
    await admin.save();
    return admin;
  }
}
