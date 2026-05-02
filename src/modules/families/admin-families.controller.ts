import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { UpdateFamilyStatusDto } from './dto/family.dto';
import { FamiliesService } from './families.service';
import { FamilyStatus } from './schemas/family.schema';

/**
 * Admin oversight for families. User-driven CRUD lives on the mobile-side
 * controller — admins can browse, view, freeze, and force-disband, but
 * cannot edit cosmetic family metadata (that's the leader's privilege).
 */
@Controller({ path: 'admin/families', version: '1' })
@AdminOnly()
export class AdminFamiliesController {
  constructor(private readonly families: FamiliesService) {}

  @RequirePermissions(PERMISSIONS.FAMILY_VIEW)
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: FamilyStatus,
    @Query('search') search?: string,
  ) {
    return this.families.list({ page, limit, status, search });
  }

  @RequirePermissions(PERMISSIONS.FAMILY_VIEW)
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const family = await this.families.getByIdOrThrow(id);
    return { family };
  }

  @RequirePermissions(PERMISSIONS.FAMILY_VIEW)
  @Get(':id/members')
  async listMembers(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.families.listMembers(id, { page, limit });
  }

  /** Freeze / unfreeze / force-disband. Disband detaches all members. */
  @RequirePermissions(PERMISSIONS.FAMILY_MANAGE)
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateFamilyStatusDto,
  ) {
    const family = await this.families.setStatus(id, dto.status);
    return { family };
  }
}
