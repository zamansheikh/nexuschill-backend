import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import {
  CreateHonorItemDto,
  GrantHonorDto,
  UpdateHonorItemDto,
} from './dto/honors.dto';
import { HonorCategory } from './schemas/honor-item.schema';
import { HonorsService } from './honors.service';

/// Admin oversight + management for honors.
///
/// Two surfaces:
///   • catalog CRUD under `/admin/honors` — gated by `honors.manage`.
///   • per-user grant/revoke under `/admin/users/:id/honors` — gated
///     by `honors.grant` (a moderator can hand out medals without
///     having full catalog edit rights).
@Controller({ version: '1' })
@AdminOnly()
export class HonorsAdminController {
  constructor(private readonly honors: HonorsService) {}

  // -------- Catalog --------

  @RequirePermissions(PERMISSIONS.HONORS_VIEW)
  @Get('admin/honors')
  async listCatalog(
    @Query('category') category?: HonorCategory,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.honors.listCatalog({ category, search, page, limit });
  }

  @RequirePermissions(PERMISSIONS.HONORS_VIEW)
  @Get('admin/honors/:id')
  async getOne(@Param('id') id: string) {
    const item = await this.honors.getByIdOrThrow(id);
    return { item };
  }

  @RequirePermissions(PERMISSIONS.HONORS_MANAGE)
  @Post('admin/honors')
  async create(@Body() dto: CreateHonorItemDto) {
    const item = await this.honors.create(dto);
    return { item };
  }

  @RequirePermissions(PERMISSIONS.HONORS_MANAGE)
  @Patch('admin/honors/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateHonorItemDto) {
    const item = await this.honors.update(id, dto);
    return { item };
  }

  // -------- Per-user grant / revoke --------

  /** Read a user's earned honors — useful in admin Users views to
   *  inspect what's been granted previously before issuing more. */
  @RequirePermissions(PERMISSIONS.HONORS_VIEW)
  @Get('admin/users/:id/honors')
  async listForUser(@Param('id') userId: string) {
    return this.honors.listForUser(userId);
  }

  /** Grant an honor to a user. Idempotent on (user, honor) — re-grant
   *  bumps the tier rather than duplicating. */
  @RequirePermissions(PERMISSIONS.HONORS_GRANT)
  @Post('admin/users/:id/honors')
  async grant(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') userId: string,
    @Body() dto: GrantHonorDto,
  ) {
    const grant = await this.honors.grantToUser(userId, dto, {
      grantedByAdminId: admin.adminId,
    });
    return { grant };
  }

  @RequirePermissions(PERMISSIONS.HONORS_GRANT)
  @Delete('admin/users/:id/honors/:honorItemId')
  async revoke(
    @Param('id') userId: string,
    @Param('honorItemId') honorItemId: string,
  ) {
    return this.honors.revokeFromUser(userId, honorItemId);
  }
}
