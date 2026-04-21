import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import {
  AdminStatus,
  AdminUserDocument,
} from '../admin-users/schemas/admin-user.schema';
import { AdminRoleDocument } from '../admin-users/schemas/admin-role.schema';
import { AdminUsersService } from '../admin-users/admin-users.service';
import { AdminJwtPayload, AdminTokenPair, AdminTokenService } from './services/admin-token.service';

interface AuthContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface AdminAuthResult {
  admin: AdminUserDocument;
  role: AdminRoleDocument;
  tokens: AdminTokenPair;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly tokens: AdminTokenService,
  ) {}

  async login(identifier: string, password: string, ctx?: AuthContext): Promise<AdminAuthResult> {
    const admin = await this.adminUsers.findByIdentifier(identifier, true);
    if (!admin || !admin.passwordHash) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    if (admin.status === AdminStatus.DISABLED) {
      throw new UnauthorizedException({
        code: 'ADMIN_DISABLED',
        message: 'This account has been disabled',
      });
    }

    if (admin.status === AdminStatus.LOCKED && admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'ADMIN_LOCKED',
        message: 'Account is temporarily locked. Try again later.',
        details: { lockedUntil: admin.lockedUntil.toISOString() },
      });
    }

    const matches = await bcrypt.compare(password, admin.passwordHash);
    if (!matches) {
      await this.adminUsers.recordFailedLogin(admin._id.toString());
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const role = await this.adminUsers.findRoleById(admin.roleId.toString());
    if (!role || !role.active) {
      throw new UnauthorizedException({
        code: 'ROLE_INVALID',
        message: 'Assigned role is invalid or inactive. Contact a super admin.',
      });
    }

    const payload: AdminJwtPayload = {
      sub: admin._id.toString(),
      type: 'admin',
      role: role.name,
      roleId: role._id.toString(),
      permissions: role.permissions,
      scopeType: admin.scopeType ?? null,
      scopeId: admin.scopeId ? admin.scopeId.toString() : null,
    };

    const tokens = await this.tokens.issue(payload, ctx);

    await this.adminUsers.markLogin(admin._id.toString(), ctx?.ipAddress);

    return { admin, role, tokens };
  }

  async refresh(oldRefreshToken: string, ctx?: AuthContext): Promise<AdminTokenPair> {
    const record = await this.tokens.validateRefresh(oldRefreshToken);

    const admin = await this.adminUsers.findById(record.adminId.toString());
    if (!admin) {
      throw new UnauthorizedException({ code: 'ADMIN_NOT_FOUND', message: 'Admin not found' });
    }
    if (admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException({
        code: 'ADMIN_INACTIVE',
        message: 'Admin account is not active',
      });
    }

    const role = await this.adminUsers.findRoleById(admin.roleId.toString());
    if (!role || !role.active) {
      throw new UnauthorizedException({ code: 'ROLE_INVALID', message: 'Role is invalid' });
    }

    const payload: AdminJwtPayload = {
      sub: admin._id.toString(),
      type: 'admin',
      role: role.name,
      roleId: role._id.toString(),
      permissions: role.permissions,
      scopeType: admin.scopeType ?? null,
      scopeId: admin.scopeId ? admin.scopeId.toString() : null,
    };

    const pair = await this.tokens.issue(payload, ctx);
    await this.tokens.markReplaced(record, pair.refreshToken);
    return pair;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }
}
