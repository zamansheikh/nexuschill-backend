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

import { AdminOnly } from '../admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../permissions.catalog';
import { AdminUsersService } from './admin-users.service';
import { permissionCategories } from './permissions-catalog.helper';
import { CreateAdminDto } from './dto/create-admin.dto';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { ResetAdminPasswordDto, UpdateAdminDto } from './dto/update-admin.dto';
import { AdminStatus } from './schemas/admin-user.schema';

@Controller({ path: 'admin', version: '1' })
@AdminOnly()
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  // =============== Permissions catalog ===============

  @RequirePermissions(PERMISSIONS.ADMIN_VIEW)
  @Get('permissions')
  async listPermissions() {
    return { categories: permissionCategories() };
  }

  // =============== Roles ===============

  @RequirePermissions(PERMISSIONS.ADMIN_VIEW)
  @Get('roles')
  async listRoles() {
    const roles = await this.adminUsers.listRoles();
    return { roles };
  }

  @RequirePermissions(PERMISSIONS.ADMIN_ROLE_MANAGE)
  @Post('roles')
  async createRole(@Body() dto: CreateRoleDto) {
    const role = await this.adminUsers.createRole(dto);
    return { role };
  }

  @RequirePermissions(PERMISSIONS.ADMIN_ROLE_MANAGE)
  @Patch('roles/:id')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const role = await this.adminUsers.updateRole(id, dto);
    return { role };
  }

  @RequirePermissions(PERMISSIONS.ADMIN_ROLE_MANAGE)
  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string) {
    await this.adminUsers.deleteRole(id);
    return { success: true };
  }

  // =============== Admins ===============

  @RequirePermissions(PERMISSIONS.ADMIN_VIEW)
  @Get('users')
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('roleId') roleId?: string,
    @Query('status') status?: AdminStatus,
    @Query('search') search?: string,
  ) {
    return this.adminUsers.list({ page, limit, roleId, status, search });
  }

  @RequirePermissions(PERMISSIONS.ADMIN_VIEW)
  @Get('users/:id')
  async getOne(@Param('id') id: string) {
    const admin = await this.adminUsers.getByIdOrThrow(id);
    return { admin };
  }

  @RequirePermissions(PERMISSIONS.ADMIN_CREATE)
  @Post('users')
  async create(@Body() dto: CreateAdminDto, @CurrentAdmin() current: AuthenticatedAdmin) {
    const admin = await this.adminUsers.create({ ...dto, createdBy: current.adminId });
    return { admin };
  }

  @RequirePermissions(PERMISSIONS.ADMIN_UPDATE)
  @Patch('users/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateAdminDto) {
    const admin = await this.adminUsers.update(id, dto);
    return { admin };
  }

  @RequirePermissions(PERMISSIONS.ADMIN_UPDATE)
  @Post('users/:id/reset-password')
  async resetPassword(@Param('id') id: string, @Body() dto: ResetAdminPasswordDto) {
    await this.adminUsers.resetPassword(id, dto.newPassword);
    return { success: true };
  }
}
