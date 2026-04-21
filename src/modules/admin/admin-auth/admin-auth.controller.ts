import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { Public } from '../../../common/decorators/public.decorator';
import { AdminUsersService } from '../admin-users/admin-users.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminOnly } from './decorators/admin-only.decorator';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { AdminLoginDto, AdminRefreshDto } from './dto/admin-login.dto';
import { AuthenticatedAdmin } from './strategies/admin-jwt.strategy';

@Controller({ path: 'admin/auth', version: '1' })
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly adminUsers: AdminUsersService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const result = await this.auth.login(dto.identifier, dto.password, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    return {
      admin: result.admin,
      role: result.role,
      tokens: result.tokens,
    };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: AdminRefreshDto, @Req() req: Request) {
    const tokens = await this.auth.refresh(dto.refreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    return { tokens };
  }

  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body() dto: AdminRefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { success: true };
  }

  @AdminOnly()
  @Get('me')
  async me(@CurrentAdmin() current: AuthenticatedAdmin) {
    const admin = await this.adminUsers.getByIdOrThrow(current.adminId);
    const role = await this.adminUsers.findRoleById(current.roleId);
    return {
      admin,
      role,
      permissions: current.permissions,
      scope: current.scopeType ? { type: current.scopeType, id: current.scopeId } : null,
    };
  }
}
