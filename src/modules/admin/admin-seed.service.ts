import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';

import { AdminRole, AdminRoleDocument } from './admin-users/schemas/admin-role.schema';
import { AdminStatus, AdminUser, AdminUserDocument } from './admin-users/schemas/admin-user.schema';
import { DEFAULT_ROLES } from './permissions.catalog';

@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectModel(AdminRole.name) private readonly roleModel: Model<AdminRoleDocument>,
    @InjectModel(AdminUser.name) private readonly adminModel: Model<AdminUserDocument>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedRoles();
    await this.seedSuperAdmin();
  }

  private async seedRoles() {
    let createdCount = 0;
    let patchedCount = 0;
    for (const r of DEFAULT_ROLES) {
      const existing = await this.roleModel.findOne({ name: r.name }).exec();
      if (!existing) {
        await this.roleModel.create({ ...r, active: true });
        createdCount++;
      } else if (existing.isSystem) {
        // Keep admin-customized permissions, but ensure structural fields
        // (scopeType / isSystem) match the current catalog. This lets us ship
        // schema-level fixes without losing permission edits.
        const desiredScope = (r as any).scopeType ?? null;
        if (existing.scopeType !== desiredScope) {
          existing.scopeType = desiredScope;
          await existing.save();
          patchedCount++;
        }
      }
    }
    if (createdCount > 0) {
      this.logger.log(`Seeded ${createdCount} default admin role(s)`);
    }
    if (patchedCount > 0) {
      this.logger.log(`Patched scopeType on ${patchedCount} existing system role(s)`);
    }
  }

  private async seedSuperAdmin() {
    const email = this.config.get<string>('superAdmin.email');
    const password = this.config.get<string>('superAdmin.password');
    const username = this.config.get<string>('superAdmin.username') || 'superadmin';

    if (!email || !password) {
      this.logger.warn(
        'SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping super admin seed. ' +
          'Set them in .env to auto-create the first admin.',
      );
      return;
    }

    const anyAdmin = await this.adminModel.countDocuments().exec();
    if (anyAdmin > 0) return;

    const role = await this.roleModel.findOne({ name: 'super_admin' }).exec();
    if (!role) {
      this.logger.error('super_admin role is missing — cannot seed super admin');
      return;
    }

    const rounds = this.config.get<number>('security.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(password, rounds);

    await this.adminModel.create({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      passwordHash,
      displayName: 'Super Admin',
      roleId: role._id,
      scopeType: null,
      scopeId: null,
      status: AdminStatus.ACTIVE,
      mustChangePassword: true,
    });

    this.logger.warn(
      `Super admin seeded — email: ${email} / username: ${username}. ` +
        `CHANGE THE PASSWORD IMMEDIATELY after first login.`,
    );
  }
}
